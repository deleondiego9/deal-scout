import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./env.js";
import {
  findDealByUrl,
  getDeal,
  latestScan,
  listDeals,
  stats,
  updateDeal,
} from "./db.js";
import { ingestDeal, importScan, runScan } from "./scanner.js";
import { canonicalizeUrl } from "./urls.js";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

function readApiKey(req) {
  const header = req.get("authorization") || "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return req.get("x-api-key") || req.body?.apiKey || "";
}

export function createApp(db, options = {}) {
  const cfg = { ...config(), ...options };
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use(
    express.static(publicDir, {
      setHeaders(res, filePath) {
        if (filePath.endsWith("manifest.json")) {
          res.setHeader("Content-Type", "application/manifest+json");
        }
      },
    })
  );

  let scanLock = null;

  function requireKey(req, res, next) {
    if (!cfg.apiKey) return next();
    if (readApiKey(req) !== cfg.apiKey) {
      return res.status(401).json({ error: "Invalid or missing API key" });
    }
    next();
  }

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "deal-scout" });
  });

  app.get("/api/stats", (_req, res) => {
    res.json({ stats: stats(db), lastScan: latestScan(db) });
  });

  app.get("/api/deals", (req, res) => {
    if (req.query.url) {
      let url;
      try {
        url = canonicalizeUrl(String(req.query.url));
      } catch {
        return res.status(400).json({ error: "Invalid url" });
      }
      const deal = findDealByUrl(db, url);
      return res.json({ known: Boolean(deal), deal });
    }
    const deals = listDeals(db, {
      status: req.query.status,
      qualified: req.query.qualified,
      q: req.query.q,
      called: req.query.called,
    });
    res.json({ deals });
  });

  app.get("/api/deals/:id", (req, res) => {
    const deal = getDeal(db, Number(req.params.id));
    if (!deal) return res.status(404).json({ error: "Not found" });
    res.json({ deal });
  });

  app.patch("/api/deals/:id", (req, res) => {
    try {
      const body = req.body || {};
      const deal = updateDeal(db, Number(req.params.id), {
        status: body.status,
        notes: body.notes,
        called: body.called,
      });
      if (!deal) return res.status(404).json({ error: "Not found" });
      res.json({ deal });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/deals", requireKey, (req, res) => {
    try {
      const result = ingestDeal(db, req.body || {});
      res.status(result.inserted ? 201 : 200).json({
        inserted: result.inserted,
        repeated: result.repeated,
        deal: result.deal,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/scan/import", requireKey, (req, res) => {
    try {
      const listings = Array.isArray(req.body?.listings) ? req.body.listings : [];
      const summary = importScan(db, listings, {
        origin: req.body?.origin || "harvest",
        queriesRun: Number(req.body?.queriesRun) || 0,
        requireBoth: cfg.scanRequireBoth,
        maxResults: cfg.scanMaxResults,
      });
      res.json({ summary, lastScan: latestScan(db) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/scan", async (req, res) => {
    if (scanLock) {
      return res.status(409).json({ error: "A scan is already running" });
    }
    scanLock = runScan(db, {
      delayMs: cfg.scanDelayMs,
      maxResults: cfg.scanMaxResults,
      requireBoth: cfg.scanRequireBoth,
      enrich: Boolean(req.body?.enrich),
      fetchImpl: options.fetchImpl,
      queries: options.queries,
    })
      .then((summary) => {
        scanLock = null;
        return summary;
      })
      .catch((error) => {
        scanLock = null;
        throw error;
      });

    try {
      const summary = await scanLock;
      res.json({ summary, lastScan: latestScan(db) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/scans/latest", (_req, res) => {
    res.json({ lastScan: latestScan(db) });
  });

  return app;
}
