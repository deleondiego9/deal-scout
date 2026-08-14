import { join } from "node:path";
import { loadEnv, config } from "../src/env.js";
import { openDb } from "../src/db.js";
import { runScan } from "../src/scanner.js";

loadEnv();
const cfg = config();
const db = openDb(join(cfg.dataDir, "deals.sqlite"));

const summary = await runScan(db, {
  delayMs: cfg.scanDelayMs,
  maxResults: cfg.scanMaxResults,
  requireBoth: cfg.scanRequireBoth,
});

console.log(JSON.stringify(summary, null, 2));
db.close();
process.exit(summary.error ? 1 : 0);
