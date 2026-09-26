import { type ReactNode } from "react";
import { useRoom } from "../lib/room";
import { TruthFalse } from "../games/TruthFalse";
import { TruthOrDare } from "../games/TruthOrDare";
import { DrawTogether } from "../games/DrawTogether";
import { CoopPuzzle } from "../games/CoopPuzzle";
import { ThisOrThat, WouldYouRather } from "../games/ChoiceGames";
import { KnowMe } from "../games/KnowMe";
import { WordAssociation } from "../games/WordAssociation";
import { StoryTogether } from "../games/StoryTogether";
import { GuessThePlayer } from "../games/GuessThePlayer";
import { Uno } from "../games/Uno";
import { Ludo } from "../games/Ludo";

/** Routes the active game to its UI. Adding a game = one import + one case. */
export function GameStage(): ReactNode {
  const { room, gameState, gameSessionId } = useRoom();

  if (!room?.gameId) {
    return (
      <div className="game-panel">
        <p className="muted">No game is running.</p>
      </div>
    );
  }

  if (!gameState || !gameSessionId) {
    return (
      <div className="game-panel">
        <span className="spinner" aria-label="Loading game" />
      </div>
    );
  }

  switch (room.gameId) {
    case "truth_false":
      return <TruthFalse state={gameState} />;
    case "truth_or_dare":
      return <TruthOrDare state={gameState} />;
    case "draw_together":
      return <DrawTogether state={gameState} />;
    case "coop_puzzle":
      return <CoopPuzzle state={gameState} />;
    case "this_or_that":
      return <ThisOrThat state={gameState} />;
    case "know_me":
      return <KnowMe state={gameState} />;
    case "word_association":
      return <WordAssociation state={gameState} />;
    case "story_together":
      return <StoryTogether state={gameState} />;
    case "would_you_rather":
      return <WouldYouRather state={gameState} />;
    case "guess_the_player":
      return <GuessThePlayer state={gameState} />;
    case "uno":
      return <Uno state={gameState} />;
    case "ludo":
      return <Ludo state={gameState} />;
    default:
      return (
        <div className="game-panel">
          <p className="muted">This game isn't available yet.</p>
        </div>
      );
  }
}
