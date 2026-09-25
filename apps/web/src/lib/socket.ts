import { io, type Socket } from "socket.io-client";

type Listener = (connected: boolean) => void;

let socket: Socket | null = null;
const connListeners = new Set<Listener>();

export function getSocket(): Socket {
  if (socket) return socket;
  socket = io({
    withCredentials: true,
    transports: ["websocket", "polling"],
    reconnectionDelayMax: 5000,
  });
  socket.on("connect", () => {
    for (const l of connListeners) l(true);
  });
  socket.on("disconnect", () => {
    for (const l of connListeners) l(false);
  });
  return socket;
}

export function onConnectChange(fn: Listener): () => void {
  connListeners.add(fn);
  return () => connListeners.delete(fn);
}

export function socketEmitAck<T = { ok: boolean; error?: string }>(
  event: string,
  payload?: unknown,
): Promise<T> {
  const s = getSocket();
  return new Promise((resolve) => {
    s.timeout(8000).emit(event, payload, (err: unknown, res: T) => {
      if (err) resolve({ ok: false, error: "Connection timed out" } as T);
      else resolve(res);
    });
  });
}
