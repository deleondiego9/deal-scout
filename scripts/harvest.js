import { loadEnv, config } from "../src/env.js";
import { collectListingResults, DEFAULT_QUERIES } from "../src/search.js";

loadEnv();
const cfg = config();
const appUrl = process.env.APP_URL || process.env.DEAL_SCOUT_URL || "";
const apiKey = process.env.API_KEY || cfg.apiKey || "";

if (!appUrl) {
  console.log("APP_URL is not set. Skipping harvest.");
  process.exit(0);
}

const listings = await collectListingResults(DEFAULT_QUERIES, { searchDelayMs: 500 });
const root = appUrl.replace(/\/+$/, "");
const target = `${root}/api/scan/import`;
const response = await fetch(target, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
  },
  body: JSON.stringify({
    listings,
    queriesRun: DEFAULT_QUERIES.length,
    origin: "github-harvest",
  }),
});

const body = await response.text();
if (!response.ok) {
  console.error(body);
  process.exit(1);
}
console.log(body);
