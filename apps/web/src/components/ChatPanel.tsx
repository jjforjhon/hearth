import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRoom } from "../lib/room";
import { useSession } from "../lib/session";

const QUICK_EMOJI = ["👍", "😄", "😂", "😮", "❤️"];

export function ChatPanel({
  sessionId,
  placeholder = "Say something…",
  compact = false,
}: {
  sessionId?: string | null;
  placeholder?: string;
  compact?: boolean;
}): ReactNode {
  const { messages, sendChat, react, sendTyping, typing, room } = useRoom();
  const { user } = useSession();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastTyping = useRef<number>(0);

  const filtered = sessionId
    ? messages.filter((m) => m.roomSessionId === sessionId || m.roomSessionId === "room")
    : messages;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filtered.length, typing]);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText("");
    sendChat(body, sessionId ?? null).catch((err) => {
      setError(err instanceof Error ? err.message : "Message failed to send");
      setText(body); // preserve unsent text
    });
  };

  return (
    <div className="chat" style={compact ? { minHeight: 0 } : undefined}>
      <div className="chat-scroll" ref={scrollRef} aria-label="Room chat" role="log">
        {filtered.length === 0 && (
          <div className="chat-msg-system">No messages yet — say hi!</div>
        )}
        {filtered.map((m) => {
          if (m.kind === "system") {
            return (
              <div key={m.id} className="chat-msg-system">
                {m.body}
              </div>
            );
          }
          const mine = user?.id === m.senderId;
          const name = m.senderName ?? "Someone";
          return (
            <div key={m.id} className={`chat-msg${mine ? " chat-msg-mine" : ""}`}>
              <div className="chat-msg-head">
                {mine ? "You" : <strong>{name}</strong>}{" "}
                <span suppressHydrationWarning>
                  {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <div className="chat-bubble">
                {m.kind === "media" && m.mediaUrl ? (
                  <img src={m.mediaUrl} alt="Shared media" loading="lazy" />
                ) : (
                  m.body
                )}
              </div>
              {Object.keys(m.reactions).length > 0 && (
                <div className="chat-reactions">
                  {Object.entries(m.reactions).map(([emoji, userIds]) => (
                    <button
                      key={emoji}
                      className={`chat-reaction${user?.id && userIds.includes(user.id) ? " mine" : ""}`}
                      onClick={() => void react(m.id, emoji)}
                      title={userIds.map((id) => room?.members.find((mm) => mm.userId === id)?.displayName ?? "someone").join(", ")}
                      aria-label={`Reaction ${emoji} from ${userIds.length} ${userIds.length === 1 ? "person" : "people"}`}
                    >
                      {emoji} {userIds.length}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="chat-typing">{typing ? `${typing} is typing…` : ""}</div>
      <form className="chat-input-row" onSubmit={submit}>
        <input
          className="input chat-input"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const now = Date.now();
            if (now - lastTyping.current > 1500) {
              lastTyping.current = now;
              sendTyping();
            }
          }}
          placeholder={placeholder}
          maxLength={1000}
          aria-label="Chat message"
        />
        <div className="row" style={{ gap: 2 }}>
          {QUICK_EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label={`React ${e}`}
              onClick={() => {
                const last = filtered[filtered.length - 1];
                if (last && last.kind !== "system") void react(last.id, e);
              }}
            >
              {e}
            </button>
          ))}
        </div>
        <button className="btn btn-primary btn-sm" disabled={!text.trim()}>
          Send
        </button>
      </form>
      {error && (
        <div className="chat-typing" role="alert">
          {error} — your message was kept.
        </div>
      )}
    </div>
  );
}
