import { type ReactNode } from "react";
import { useRoom } from "../lib/room";
import { useSession } from "../lib/session";
import { useCountdown } from "../lib/useCountdown";
import { GameChrome, Scores } from "../components/GameChrome";

export interface ChoiceView {
  round: number;
  totalRounds: number;
  current: {
    optionA: string;
    optionB: string;
    myVote: string | null;
    revealed: boolean;
    votesA: string[] | null;
    votesB: string[] | null;
    deadline: number;
  } | null;
  scores: Record<string, number>;
}

/** Shared UI for both binary-choice games. `names` maps userId -> displayName. */
export function ChoiceGame({
  state,
  emoji,
}: {
  state: Record<string, unknown>;
  emoji: [string, string];
}): ReactNode {
  const v = state as unknown as ChoiceView;
  const { room, gameAction } = useRoom();
  const { user } = useSession();
  const remaining = useCountdown(v.current?.deadline);

  const nameOf = (id: string): string =>
    room?.members.find((m) => m.userId === id)?.displayName ?? "Someone";

  if (!v.current) {
    return (
      <GameChrome round={v.round} totalRounds={v.totalRounds} scores={v.scores}>
        <p className="muted">Loading the next dilemma…</p>
        <button className="btn btn-primary" onClick={() => void gameAction("next")}>
          Begin
        </button>
      </GameChrome>
    );
  }

  const cur = v.current;
  const countA = cur.votesA?.length ?? 0;
  const countB = cur.votesB?.length ?? 0;
  const total = countA + countB;

  return (
    <GameChrome round={v.round} totalRounds={v.totalRounds} scores={v.scores}>
      <div className="choice-grid">
        {(["a", "b"] as const).map((choice) => {
          const option = choice === "a" ? cur.optionA : cur.optionB;
          const voters = choice === "a" ? cur.votesA : cur.votesB;
          const count = choice === "a" ? countA : countB;
          return (
            <button
              key={choice}
              className={`choice-btn${cur.myVote === choice ? " selected" : ""}`}
              disabled={!!cur.myVote || cur.revealed}
              onClick={() => void gameAction("vote", { choice })}
            >
              <span aria-hidden style={{ marginRight: 6 }}>
                {choice === "a" ? emoji[0] : emoji[1]}
              </span>
              {option}
              {cur.revealed && (
                <span className="choice-pct">
                  {total > 0 ? Math.round((count / total) * 100) : 0}% ·{" "}
                  {voters && voters.length > 0 ? voters.map(nameOf).join(", ") : "nobody"}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="game-timer">
        {cur.revealed
          ? "Discuss!"
          : cur.myVote
            ? `Locked in — waiting for the others ${remaining !== null ? `· ${remaining}s` : ""}`
            : remaining !== null
              ? `${remaining}s to decide`
              : "Pick one"}
      </p>
      {cur.revealed && (
        <button className="btn btn-primary" onClick={() => void gameAction("next")}>
          {v.round >= v.totalRounds ? "See results" : "Next"}
        </button>
      )}
      <Scores scores={withNames(v.scores, nameOf)} />
    </GameChrome>
  );
}

function withNames(
  scores: Record<string, number>,
  nameOf: (id: string) => string,
): Record<string, { score: number; name: string }> {
  return Object.fromEntries(Object.entries(scores).map(([id, score]) => [id, { score, name: nameOf(id) }]));
}

export function ThisOrThat({ state }: { state: Record<string, unknown> }): ReactNode {
  return <ChoiceGame state={state} emoji={["🅰️", "🅱️"]} />;
}

export function WouldYouRather({ state }: { state: Record<string, unknown> }): ReactNode {
  return <ChoiceGame state={state} emoji={["🤔", "😵‍💫"]} />;
}
