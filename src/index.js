import { join } from "node:path";
import { loadEnv, config } from "./env.js";
import { openDb } from "./db.js";
import { createApp } from "./server.js";

loadEnv();
const cfg = config();
const db = openDb(join(cfg.dataDir, "deals.sqlite"));
const app = createApp(db, cfg);

const server = app.listen(cfg.port, cfg.host, () => {
  console.log(`Deal Scout running on http://${cfg.host}:${cfg.port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
