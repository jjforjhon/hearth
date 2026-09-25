import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getSocket, onConnectChange } from "./socket";
import { api } from "./api";
import type { ChatMessageView, RoomView } from "@hearth/shared";

export interface GameEventMsg {
  type: string;
  [key: string]: unknown;
}

interface RoomCtx {
  room: RoomView | null;
  connected: boolean;
  loading: boolean;
  error: string | null;
  messages: ChatMessageView[];
  typing: string | null;
  gameSessionId: string | null;
  gameState: Record<string, unknown> | null;
  gameEvents: GameEventMsg[];
  myUserId: string | null;
  sendChat: (body: string, sessionId?: string | null) => Promise<void>;
  react: (messageId: string, emoji: string) => Promise<void>;
  sendTyping: () => void;
  gameAction: (action: string, payload?: unknown) => Promise<{ ok: boolean; error?: string }>;
  emitGameEvent: (event: string, payload: unknown) => void;
  leave: () => Promise<void>;
}

const Ctx = createContext<RoomCtx | null>(null);

export function RoomProvider({ code, children }: { code: string; children: ReactNode }): ReactNode {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [typing, setTyping] = useState<string | null>(null);
  const [gameSessionId, setGameSessionId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<Record<string, unknown> | null>(null);
  const [gameEvents, setGameEvents] = useState<GameEventMsg[]>([]);
  const typingTimer = useRef<number>(0);
  const roomRef = useRef<RoomView | null>(null);
  roomRef.current = room;

  // The socket is authenticated server-side by cookie, so the own member entry
  // is found by matching... we can't know our id client-side without an extra
  // fetch; the session context provides it. Room consumers combine useRoom() +
  // useSession() when they need "me".
  const myUserId = null;

  // Socket lifecycle
  useEffect(() => {
    const s = getSocket();
    const off = onConnectChange(setConnected);

    const onRoomView = (view: RoomView) => {
      setRoom(view);
      setLoading(false);
      setError(null);
    };

    const onChatMessage = (msg: ChatMessageView) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    };

    const onChatDeleted = (p: { id: string }) => {
      setMessages((prev) => prev.filter((m) => m.id !== p.id));
    };

    const onChatReaction = (p: { id: string; emoji: string; userId: string; op: "added" | "removed" }) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== p.id) return m;
          const reactions = { ...m.reactions };
          const list = new Set(reactions[p.emoji] ?? []);
          if (p.op === "added") list.add(p.userId);
          else list.delete(p.userId);
          if (list.size === 0) delete reactions[p.emoji];
          else reactions[p.emoji] = [...list];
          return { ...m, reactions };
        }),
      );
    };

    const onTyping = (p: { userId: string; name: string }) => {
      setTyping(p.name);
      window.clearTimeout(typingTimer.current);
      typingTimer.current = window.setTimeout(() => setTyping(null), 2500);
    };

    const onGameSession = (p: { sessionId: string; gameId: string }) => {
      setGameSessionId(p.sessionId);
    };

    const onGameState = (p: { sessionId: string; view: Record<string, unknown> }) => {
      setGameSessionId(p.sessionId);
      setGameState(p.view);
    };

    const onGameEvent = (p: GameEventMsg) => {
      setGameEvents((prev) => [...prev.slice(-200), p]);
    };

    const onGameCompleted = (p: { sessionId: string; standings: Array<{ userId: string; displayName: string; score: number }> }) => {
      setGameState((prev) =>
        prev ? { ...prev, __completed: true, __standings: p.standings } : prev,
      );
    };

    const onKicked = () => {
      setError("You were removed from this room by the host.");
      setRoom(null);
    };

    s.on("room:view", onRoomView);
    s.on("chat:message", onChatMessage);
    s.on("chat:deleted", onChatDeleted);
    s.on("chat:reaction", onChatReaction);
    s.on("chat:typing", onTyping);
    s.on("game:session", onGameSession);
    s.on("game:state", onGameState);
    s.on("game:event", onGameEvent);
    s.on("game:completed", onGameCompleted);
    s.on("room:kicked", onKicked);

    return () => {
      s.off("room:view", onRoomView);
      s.off("chat:message", onChatMessage);
      s.off("chat:deleted", onChatDeleted);
      s.off("chat:reaction", onChatReaction);
      s.off("chat:typing", onTyping);
      s.off("game:session", onGameSession);
      s.off("game:state", onGameState);
      s.off("game:event", onGameEvent);
      s.off("game:completed", onGameCompleted);
      s.off("room:kicked", onKicked);
      off();
    };
  }, []);

  // Join by code
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = getSocket();
      // wait for connection first
      if (!s.connected) {
        await new Promise<void>((resolve) => {
          const check = () => {
            if (s.connected) resolve();
            else s.once("connect", check);
          };
          check();
        });
      }
      if (cancelled) return;
      const res = await new Promise<{ ok: boolean; error?: string; roomId?: string }>((resolve) => {
        s.timeout(8000).emit("room:join", { code }, (err: unknown, r: { ok: boolean; error?: string; roomId?: string }) => {
          resolve(err ? { ok: false, error: "Could not reach the room" } : r);
        });
      });
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error ?? "Could not join this room");
        setLoading(false);
        return;
      }
      // fetch recent room chat
      try {
        const roomId = res.roomId!;
        const data = await api.get<{ messages: ChatMessageView[] }>(`/api/rooms/${roomId}/messages`);
        if (!cancelled) setMessages(data.messages);
      } catch {
        /* chat history is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const sendChat = useCallback(async (body: string, sessionId?: string | null) => {
    const r = roomRef.current;
    if (!r) return;
    await api.post(`/api/rooms/${r.id}/messages`, { body, sessionId: sessionId ?? undefined });
  }, []);

  const react = useCallback(async (messageId: string, emoji: string) => {
    await api.post(`/api/messages/${messageId}/react`, { emoji });
  }, []);

  const sendTyping = useCallback(() => {
    getSocket().emit("chat:typing", {});
  }, []);

  const gameAction = useCallback(async (action: string, payload?: unknown) => {
    return socketEmitAck<{ ok: boolean; error?: string }>("game:action", { action, payload: payload ?? {} });
  }, []);

  const emitGameEvent = useCallback((event: string, payload: unknown) => {
    // Reserved for future client→server streaming events (e.g. cursor presence).
    getSocket().emit(event, payload);
  }, []);

  const leave = useCallback(async () => {
    const r = roomRef.current;
    if (r) {
      try {
        await api.post(`/api/rooms/${r.id}/leave`);
      } catch {
        /* already gone */
      }
    }
    getSocket().emit("room:leave");
  }, []);

  const value: RoomCtx = {
    room,
    connected,
    loading,
    error,
    messages,
    typing,
    gameSessionId,
    gameState,
    gameEvents,
    myUserId,
    sendChat,
    react,
    sendTyping,
    gameAction,
    emitGameEvent,
    leave,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function socketEmitAck<T>(event: string, payload: unknown): Promise<T> {
  const s = getSocket();
  return new Promise((resolve) => {
    s.timeout(8000).emit(event, payload, (err: unknown, res: T) => {
      resolve((err ? { ok: false, error: "Connection timed out" } : res) as T);
    });
  });
}

export function useRoom(): RoomCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRoom outside RoomProvider");
  return ctx;
}
