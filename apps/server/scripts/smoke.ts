// DATA_DIR must be set BEFORE the config module loads, so use dynamic imports.
process.env.DATA_DIR = process.argv[2] ?? "./data-smoke";

const { getDb } = await import("../src/db.js");
const { ensureContentBootstrapped, runWeeklyPipeline } = await import("../src/content/pipeline.js");
const { seedAllOtherGames } = await import("../src/content/seed-other.js");
const { countContent, contentPoolStats, sampleContent, sampleGenericContent } = await import("../src/store.js");

const db = getDb();
ensureContentBootstrapped();
seedAllOtherGames();
console.log("pool:", JSON.stringify(contentPoolStats()));
console.log("truths:", countContent("truth"), "dares:", countContent("dare"));
console.log("sample truth:", sampleContent("truth", 1)[0]?.body?.slice(0, 60));
console.log("sample wyr:", sampleGenericContent("choice_pair", "would_you_rather", 1)[0]?.options);
console.log("sample template:", sampleGenericContent("prompt", "draw_template", 1)[0]?.body?.slice(0, 40));

const r = await runWeeklyPipeline({ weekKey: "2026-W99-test", batchSize: 600 });
console.log("pipeline:", JSON.stringify(r));
console.log("pool after:", JSON.stringify(contentPoolStats()));
