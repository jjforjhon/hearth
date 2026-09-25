/**
 * Scheduler verification: boots a cron schedule 15 seconds in the future and
 * proves the scheduled callback fires automatically (no manual invocation).
 * Run: npx tsx scripts/verify-cron.ts
 */
import cron from "node-cron";

const d = new Date(Date.now() + 15_000);
const expr = `${d.getSeconds()} ${d.getMinutes()} ${d.getHours()} * * *`;
let fired = false;

console.log(`schedule: "${expr}" (fires at ${d.toLocaleTimeString()})`);

const task = cron.schedule(expr, () => {
  fired = true;
  console.log(`[${new Date().toLocaleTimeString()}] CRON FIRED AUTOMATICALLY ✓`);
});

// The pipeline invocation is wired exactly like production (src/index.ts):
// cron.schedule(config.contentCron, () => void runWeeklyPipeline().catch(...))

setTimeout(() => {
  task.stop();
  console.log(fired ? "SCHEDULER VERIFIED" : "SCHEDULER DID NOT FIRE");
  process.exit(fired ? 0 : 1);
}, 20_000);
