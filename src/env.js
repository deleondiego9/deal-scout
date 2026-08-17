import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnv(cwd = process.cwd()) {
  const envPath = resolve(cwd, ".env");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function config() {
  return {
    port: Number(process.env.PORT || 3000),
    host: process.env.HOST || "0.0.0.0",
    dataDir: process.env.DATA_DIR || "./data",
    apiKey: process.env.API_KEY || "",
    scanDelayMs: Number(process.env.SCAN_DELAY_MS || 200),
    scanMaxResults: Number(process.env.SCAN_MAX_RESULTS || 80),
    scanRequireBoth: process.env.SCAN_REQUIRE_BOTH !== "0",
  };
}
