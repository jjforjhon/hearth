import { type ReactNode } from "react";
import { useRoom } from "../lib/room";
import { useSession } from "../lib/session";
import { useCountdown } from "../lib/useCountdown";
import { GameChrome, Scores } from "../components/GameChrome";

interface View {
  round: number;
  totalRounds: number;
  isSubject: boolean;
  current: {
    subjectName: string;
    prompt: string;
    myVote: string | null;
    subjectVoteRevealed: string | null;
    revealed: boolean;
    votesCount: number;
    deadline: number;
    voteBreakdown: Record<string, string> | null;
  } | null;
  scores: Record<string, { score: number; name: string }>;
}

export function TruthFalse({ state }: { state: Record<string, unknown> }): ReactNode {
  const v = state as unknown as View;
  const { gameAction } = useRoom();
  const { user } = useSession();
  const remaining = useCountdown(v.current?.deadline);

  if (!v.current) {
    return (
      <GameChrome round={v.round} totalRounds={v.totalRounds} scores={v.scores}>
        <p className="muted">Starting the next round…</p>
        <button className="btn btn-primary" onClick={() => void gameAction("next_round")}>
          Begin
        </button>
      </GameChrome>
    );
  }

  const cur = v.current;
  const revealed = cur.revealed;

  return (
    <GameChrome round={v.round} totalRounds={v.totalRounds} scores={v.scores}>
      <p className="muted small">
        {cur.subjectName} answers this statement about themselves — everyone else bets on what
        they'll say.
      </p>
      <p className="game-prompt">“{cur.prompt}”</p>
      {v.isSubject && !revealed && (
        <p className="small" style={{ color: "var(--amber-300)" }}>
          You're the subject. What's the truth for you?
        </p>
      )}
      <div className="choice-grid">
        {(["true", "false"] as const).map((choice) => {
          const selected = v.isSubject ? null : cur.myVote === choice;
          const disabled = (!v.isSubject && !!cur.myVote) || revealed;
          return (
            <button
              key={choice}
              className={`choice-btn${selected ? " selected" : ""}`}
              disabled={disabled}
              onClick={() =>
                void gameAction(v.isSubject ? "subject_answer" : "vote", { choice })
              }
            >
              {choice === "true" ? "TRUE" : "FALSE"}
              {revealed && cur.subjectVoteRevealed === choice && (
                <span className="choice-pct">← {cur.subjectName}'s answer</span>
              )}
            </button>
          );
        })}
      </div>
      {!revealed && (
        <p className="game-timer">
          {cur.myVote || v.isSubject
            ? `${cur.votesCount} bet${cur.votesCount === 1 ? "" : "s"} in`
            : "Pick one"}{" "}
          {remaining !== null && `· ${remaining}s`}
        </p>
      )}
      {revealed && (
        <button className="btn btn-primary" onClick={() => void gameAction("next_round")}>
          {v.round >= v.totalRounds ? "See results" : "Next round"}
        </button>
      )}
      <Scores scores={v.scores} />
    </GameChrome>
  );
}
