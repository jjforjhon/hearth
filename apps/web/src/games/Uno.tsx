import { useState, type ReactNode } from "react";
import { useRoom } from "../lib/room";
import { GameChrome } from "../components/GameChrome";

/**
 * UNO UI — card table with a hidden hand per player. The server view already
 * scopes `myHand` to the caller, so this component renders only what it sees.
 */

interface CardView {
  id: string;
  color: string;
  value: string;
}

interface PlayerRow {
  id: string;
  name: string;
  count: number;
}

interface View {
  players: PlayerRow[];
  myHand: CardView[];
  topCard: CardView | null;
  activeColor: string;
  direction: number;
  turnId: string | null;
  isMyTurn: boolean;
  canPassDraw: boolean;
  mustCallUno: boolean;
  deckCount: number;
  winnerId: string | null;
}

const COLOR_HEX: Record<string, string> = {
  red: "#e5484d",
  yellow: "#e6a700",
  green: "#2f9e63",
  blue: "#3b82f6",
  wild: "#1f2430",
};

const VALUE_LABEL: Record<string, string> = {
  skip: "Skip",
  reverse: "Reverse",
  draw2: "+2",
  wild: "Wild",
  wild4: "Wild +4",
};

function CardFace({ card, small }: { card: CardView; small?: boolean }): ReactNode {
  const bg = COLOR_HEX[card.color] ?? "#1f2430";
  const label = VALUE_LABEL[card.value] ?? card.value;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: small ? 34 : 58,
        height: small ? 24 : 84,
        padding: "0 8px",
        borderRadius: 8,
        background: bg,
        color: "#fff",
        fontWeight: 700,
        fontSize: small ? 12 : 16,
        border: "2px solid rgba(255,255,255,0.6)",
        boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
        textShadow: "0 1px 2px rgba(0,0,0,0.4)",
      }}
    >
      {label}
    </span>
  );
}

export function Uno({ state }: { state: Record<string, unknown> }): ReactNode {
  const v = state as unknown as View;
  const { gameAction } = useRoom();
  const [wildPick, setWildPick] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: string, payload?: unknown): Promise<void> => {
    setError(null);
    const res = await gameAction(action, payload);
    if (!res.ok) setError(res.error ?? "That didn't work");
    else setWildPick(null);
  };

  const isPlayable = (card: CardView): boolean => {
    if (card.color === "wild") return true;
    if (card.color === v.activeColor) return true;
    if (v.topCard && card.value === v.topCard.value && v.topCard.color !== "wild") return true;
    return false;
  };

  const onCardClick = (card: CardView): void => {
    if (!v.isMyTurn || v.winnerId) return;
    if (card.color === "wild") {
      setWildPick(card.id);
      return;
    }
    void act("play", { cardId: card.id });
  };

  const turnName = v.players.find((p) => p.id === v.turnId)?.name ?? "…";

  return (
    <GameChrome>
      <div className="stack" style={{ width: "100%", maxWidth: 640, alignItems: "center" }}>
        {/* Table: discard pile, active color, deck */}
        <div className="row row-wrap" style={{ gap: "var(--sp-5)", justifyContent: "center", alignItems: "center" }}>
          <div style={{ textAlign: "center" }}>
            <p className="muted small" style={{ marginBottom: 4 }}>Discard</p>
            {v.topCard ? <CardFace card={v.topCard} /> : <span className="muted">—</span>}
          </div>
          <div style={{ textAlign: "center" }}>
            <p className="muted small" style={{ marginBottom: 4 }}>Active color</p>
            <span
              aria-label={`Active color ${v.activeColor}`}
              style={{
                display: "inline-block",
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: COLOR_HEX[v.activeColor] ?? "#1f2430",
                border: "3px solid rgba(255,255,255,0.7)",
              }}
            />
          </div>
          <div style={{ textAlign: "center" }}>
            <p className="muted small" style={{ marginBottom: 4 }}>Deck</p>
            <span className="badge">🂠 {v.deckCount} left</span>
            <p className="muted small" style={{ marginTop: 4 }}>
              {v.direction === 1 ? "↻ clockwise" : "↺ counter-clockwise"}
            </p>
          </div>
        </div>

        {/* Opponents */}
        <div className="row row-wrap" style={{ justifyContent: "center", gap: "var(--sp-3)" }}>
          {v.players.map((p) => (
            <span
              key={p.id}
              className={`badge${p.id === v.turnId ? " badge-accent" : ""}`}
              title={p.name}
            >
              {p.id === v.turnId ? "▶ " : ""}{p.name}: {p.count} card{p.count === 1 ? "" : "s"}
            </span>
          ))}
        </div>

        {/* Turn banner + actions */}
        {v.isMyTurn ? (
          <p style={{ fontWeight: 700 }}>Your turn — play a card, draw, or pass.</p>
        ) : (
          <p className="muted">Waiting for {turnName}…</p>
        )}

        {v.mustCallUno && (
          <button className="btn btn-accent" onClick={() => void act("call_uno")}>
            📣 Call UNO!
          </button>
        )}

        {wildPick && (
          <div className="stack" style={{ alignItems: "center" }}>
            <p className="muted small">Choose a color for your wild card:</p>
            <div className="row" style={{ gap: "var(--sp-3)" }}>
              {["red", "yellow", "green", "blue"].map((c) => (
                <button
                  key={c}
                  className="btn btn-secondary"
                  style={{ borderColor: COLOR_HEX[c], color: COLOR_HEX[c] }}
                  onClick={() => void act("play", { cardId: wildPick, color: c })}
                >
                  {c}
                </button>
              ))}
            </div>
            <button className="btn" onClick={() => setWildPick(null)}>Cancel</button>
          </div>
        )}

        {/* My hand */}
        <div className="row row-wrap" style={{ justifyContent: "center", gap: "var(--sp-2)" }}>
          {v.myHand.map((card) => {
            const dim = v.isMyTurn && !wildPick && !isPlayable(card);
            return (
              <button
                key={card.id}
                onClick={() => onCardClick(card)}
                disabled={!v.isMyTurn || !!wildPick || v.winnerId !== null}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: dim ? "not-allowed" : "pointer",
                  opacity: dim ? 0.45 : 1,
                  filter: dim ? "grayscale(0.4)" : "none",
                }}
                aria-label={`Play ${card.color} ${VALUE_LABEL[card.value] ?? card.value}`}
              >
                <CardFace card={card} />
              </button>
            );
          })}
          {v.myHand.length === 0 && <p className="muted">Your hand is empty…</p>}
        </div>

        <div className="row" style={{ gap: "var(--sp-3)", justifyContent: "center" }}>
          {v.isMyTurn && !v.canPassDraw && !wildPick && (
            <button className="btn btn-secondary" onClick={() => void act("draw")}>
              Draw a card
            </button>
          )}
          {v.canPassDraw && (
            <>
              <span className="badge badge-accent">You drew a playable card — play it or keep it</span>
              <button className="btn btn-secondary" onClick={() => void act("pass")}>
                Keep it & pass
              </button>
            </>
          )}
        </div>

        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </GameChrome>
  );
}
