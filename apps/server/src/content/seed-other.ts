import { getDb } from "../db.js";
import { sha256Hex, now, newId } from "../util.js";
import { insertContentItem } from "../store.js";
import { wouldYouRather, thisOrThat, wordAssociationWords, coopPuzzles, guessStatements, guessThePlayerPrompts, knowMeQuestions, storyOpeners, drawTemplatesSeed } from "./library.js";

/**
 * One-time seed for non-ToD game content pools (choice pairs, words, puzzles,
 * statements, prompts). Content for these games changes rarely; the weekly
 * pipeline handles the Truth-or-Dare library.
 */
export function seedAllOtherGames(): void {
  const db = getDb();
  console.log("[content] checking other-game pools");
  let seeded = 0;
  // Seed per category so later additions (templates, new prompts) still land
  // even if bootstrap already filled other categories.
  const put = (kind: "statement" | "prompt" | "word" | "choice_pair", category: string, body: string | null, options: string[] | null, difficulty: 1 | 2 | 3 = 1) => {
    const res = insertContentItem({
      batchId: null,
      kind,
      category,
      difficulty,
      body,
      options,
      contentHash: sha256Hex(`${kind}::${category}::${(body ?? options?.join("|") ?? "").toLowerCase()}`),
      status: "active",
      published: true,
    });
    if (res.ok) seeded++;
  };

  for (const pair of wouldYouRather) put("choice_pair", "would_you_rather", null, pair, 1);
  for (const pair of thisOrThat) put("choice_pair", "this_or_that", null, pair, 1);
  for (const w of wordAssociationWords) put("word", "association", w, null, 1);
  for (const p of coopPuzzles) {
    put("prompt", "coop_puzzle", JSON.stringify({ type: p.type, body: p.body, solution: p.solution, hints: p.hints }), null, 2);
  }
  for (const s of guessStatements) put("statement", "guess_the_player", s, null, 2);
  for (const p of guessThePlayerPrompts) put("prompt", "guess_the_player_prompt", p, null, 1);
  for (const q of knowMeQuestions) put("prompt", "know_me", q, null, 1);
  for (const s of storyOpeners) put("prompt", "story", s, null, 1);
  for (const t of drawTemplatesSeed) put("prompt", "draw_template", JSON.stringify(t), null, 1);

  if (seeded > 0) console.log(`[content] seeded ${seeded} new items for other games`);
}
