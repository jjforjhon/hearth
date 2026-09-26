import type { GameId } from "@hearth/shared";
import type { GameModule, BaseGameState } from "@hearth/shared";
import { truthFalseGame } from "./truth-false.js";
import { truthOrDareGame } from "./truth-or-dare.js";
import { drawTogetherGame } from "./draw-together.js";
import { coopPuzzleGame } from "./coop-puzzle.js";
import { thisOrThatGame } from "./this-or-that.js";
import { knowMeGame } from "./know-me.js";
import { wordAssociationGame } from "./word-association.js";
import { storyTogetherGame } from "./story-together.js";
import { wouldYouRatherGame } from "./would-you-rather.js";
import { guessThePlayerGame } from "./guess-the-player.js";
import { unoGame } from "./uno.js";
import { ludoGame } from "./ludo.js";

/**
 * The game plugin table. Adding a game = implementing GameModule and adding
 * one line here. Nothing else in the platform needs to change.
 */
const registry = new Map<GameId, GameModule<BaseGameState>>([
  [truthFalseGame.id, truthFalseGame as unknown as GameModule<BaseGameState>],
  [truthOrDareGame.id, truthOrDareGame as unknown as GameModule<BaseGameState>],
  [drawTogetherGame.id, drawTogetherGame as unknown as GameModule<BaseGameState>],
  [coopPuzzleGame.id, coopPuzzleGame as unknown as GameModule<BaseGameState>],
  [thisOrThatGame.id, thisOrThatGame as unknown as GameModule<BaseGameState>],
  [knowMeGame.id, knowMeGame as unknown as GameModule<BaseGameState>],
  [wordAssociationGame.id, wordAssociationGame as unknown as GameModule<BaseGameState>],
  [storyTogetherGame.id, storyTogetherGame as unknown as GameModule<BaseGameState>],
  [wouldYouRatherGame.id, wouldYouRatherGame as unknown as GameModule<BaseGameState>],
  [guessThePlayerGame.id, guessThePlayerGame as unknown as GameModule<BaseGameState>],
  [unoGame.id, unoGame as unknown as GameModule<BaseGameState>],
  [ludoGame.id, ludoGame as unknown as GameModule<BaseGameState>],
]);

export function getGame(id: GameId): GameModule<BaseGameState> | undefined {
  return registry.get(id);
}

export function listAllGameMetadata() {
  return [...registry.values()].map((g) => ({
    id: g.id,
    name: g.name,
    tagline: g.tagline,
    description: g.description,
    minPlayers: g.minPlayers,
    maxPlayers: g.maxPlayers,
    approxMinutes: g.approxMinutes,
    style: g.style,
  }));
}
