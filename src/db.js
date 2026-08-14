import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { listingFingerprint } from "./urls.js";

function nowIso() {
  return new Date().toISOString();
}

export function openDb(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_url TEXT NOT NULL UNIQUE,
      fingerprint TEXT,
      source TEXT,
      title TEXT NOT NULL,
      price_text TEXT,
      price_amount INTEGER,
      location TEXT,
      description TEXT,
      excerpt TEXT,
      seller_financing INTEGER NOT NULL DEFAULT 0,
      real_estate_included INTEGER NOT NULL DEFAULT 0,
      qualified INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      financing_evidence TEXT,
      real_estate_evidence TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      origin TEXT NOT NULL DEFAULT 'scan',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seen_listings (
      canonical_url TEXT PRIMARY KEY,
      fingerprint TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_status TEXT
    );

    CREATE TABLE IF NOT EXISTS scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      queries_run INTEGER DEFAULT 0,
      urls_found INTEGER DEFAULT 0,
      deals_added INTEGER DEFAULT 0,
      deals_skipped INTEGER DEFAULT 0,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
    CREATE INDEX IF NOT EXISTS idx_deals_qualified ON deals(qualified);
    CREATE INDEX IF NOT EXISTS idx_deals_fingerprint ON deals(fingerprint);
  `);
  return db;
}

function rowToDeal(row) {
  if (!row) return null;
  return {
    id: row.id,
    url: row.canonical_url,
    fingerprint: row.fingerprint,
    source: row.source,
    title: row.title,
    priceText: row.price_text,
    priceAmount: row.price_amount,
    location: row.location,
    description: row.description,
    excerpt: row.excerpt,
    sellerFinancing: Boolean(row.seller_financing),
    realEstateIncluded: Boolean(row.real_estate_included),
    qualified: Boolean(row.qualified),
    score: row.score,
    financingEvidence: JSON.parse(row.financing_evidence || "[]"),
    realEstateEvidence: JSON.parse(row.real_estate_evidence || "[]"),
    status: row.status,
    origin: row.origin,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function markSeen(db, { canonicalUrl, fingerprint, status }) {
  const now = nowIso();
  const existing = db.prepare("SELECT canonical_url FROM seen_listings WHERE canonical_url = ?").get(canonicalUrl);
  if (existing) {
    db.prepare(
      "UPDATE seen_listings SET last_seen_at = ?, fingerprint = COALESCE(?, fingerprint), last_status = COALESCE(?, last_status) WHERE canonical_url = ?"
    ).run(now, fingerprint || null, status || null, canonicalUrl);
    return { repeated: true };
  }
  db.prepare(
    "INSERT INTO seen_listings (canonical_url, fingerprint, first_seen_at, last_seen_at, last_status) VALUES (?, ?, ?, ?, ?)"
  ).run(canonicalUrl, fingerprint || null, now, now, status || null);
  return { repeated: false };
}

export function findDealByUrl(db, canonicalUrl) {
  return rowToDeal(db.prepare("SELECT * FROM deals WHERE canonical_url = ?").get(canonicalUrl));
}

export function findDealByFingerprint(db, fingerprint) {
  if (!fingerprint) return null;
  const parts = String(fingerprint).split("|");
  if (parts.filter(Boolean).length < 2) return null;
  return rowToDeal(db.prepare("SELECT * FROM deals WHERE fingerprint = ?").get(fingerprint));
}

export function upsertDeal(db, input) {
  const now = nowIso();
  const fingerprint =
    input.fingerprint || listingFingerprint(input.title, input.location, input.priceAmount);
  const existing =
    findDealByUrl(db, input.canonicalUrl) || findDealByFingerprint(db, fingerprint);

  markSeen(db, {
    canonicalUrl: input.canonicalUrl,
    fingerprint,
    status: existing ? "skipped" : "added",
  });

  if (existing) {
    const sellerFinancing = Boolean(existing.sellerFinancing || input.sellerFinancing);
    const realEstateIncluded = Boolean(existing.realEstateIncluded || input.realEstateIncluded);
    const title =
      input.title && input.title.length > (existing.title || "").length ? input.title : existing.title;
    const description = existing.description || input.description || null;
    const excerpt = existing.excerpt || input.excerpt || null;
    const financingEvidence = [
      ...new Set([...(existing.financingEvidence || []), ...(input.financingEvidence || [])]),
    ];
    const realEstateEvidence = [
      ...new Set([...(existing.realEstateEvidence || []), ...(input.realEstateEvidence || [])]),
    ];
    db.prepare(
      `UPDATE deals SET
        last_seen_at = ?,
        title = ?,
        price_text = COALESCE(?, price_text),
        price_amount = COALESCE(?, price_amount),
        location = COALESCE(?, location),
        description = ?,
        excerpt = ?,
        seller_financing = ?,
        real_estate_included = ?,
        qualified = ?,
        score = ?,
        financing_evidence = ?,
        real_estate_evidence = ?
      WHERE id = ?`
    ).run(
      now,
      title,
      input.priceText || null,
      input.priceAmount ?? null,
      input.location || null,
      description,
      excerpt,
      sellerFinancing ? 1 : 0,
      realEstateIncluded ? 1 : 0,
      sellerFinancing && realEstateIncluded ? 1 : 0,
      Math.max(existing.score || 0, input.score ?? 0),
      JSON.stringify(financingEvidence),
      JSON.stringify(realEstateEvidence),
      existing.id
    );
    return { inserted: false, repeated: true, deal: getDeal(db, existing.id) };
  }

  const result = db.prepare(
    `INSERT INTO deals (
      canonical_url, fingerprint, source, title, price_text, price_amount, location,
      description, excerpt, seller_financing, real_estate_included, qualified, score,
      financing_evidence, real_estate_evidence, status, origin, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`
  ).run(
    input.canonicalUrl,
    fingerprint,
    input.source || null,
    input.title,
    input.priceText || null,
    input.priceAmount ?? null,
    input.location || null,
    input.description || null,
    input.excerpt || null,
    input.sellerFinancing ? 1 : 0,
    input.realEstateIncluded ? 1 : 0,
    input.qualified ? 1 : 0,
    input.score ?? 0,
    JSON.stringify(input.financingEvidence || []),
    JSON.stringify(input.realEstateEvidence || []),
    input.origin || "scan",
    now,
    now
  );

  return {
    inserted: true,
    repeated: false,
    deal: rowToDeal(db.prepare("SELECT * FROM deals WHERE id = ?").get(result.lastInsertRowid)),
  };
}

export function listDeals(db, { status, qualified, q } = {}) {
  let sql = "SELECT * FROM deals WHERE 1=1";
  const params = [];
  if (status && status !== "all") {
    sql += " AND status = ?";
    params.push(status);
  }
  if (qualified === true || qualified === "1") {
    sql += " AND qualified = 1";
  }
  if (q) {
    sql += " AND (title LIKE ? OR location LIKE ? OR description LIKE ? OR canonical_url LIKE ?)";
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  sql += " ORDER BY qualified DESC, score DESC, last_seen_at DESC, id DESC";
  return db.prepare(sql).all(...params).map(rowToDeal);
}

export function getDeal(db, id) {
  return rowToDeal(db.prepare("SELECT * FROM deals WHERE id = ?").get(id));
}

export function updateDealStatus(db, id, status) {
  const allowed = new Set(["new", "saved", "dismissed"]);
  if (!allowed.has(status)) throw new Error("Invalid status");
  db.prepare("UPDATE deals SET status = ? WHERE id = ?").run(status, id);
  return getDeal(db, id);
}

export function stats(db) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN qualified = 1 THEN 1 ELSE 0 END) AS qualified,
      SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS newCount,
      SUM(CASE WHEN status = 'saved' THEN 1 ELSE 0 END) AS saved
    FROM deals
  `).get();
  return {
    total: row.total || 0,
    qualified: row.qualified || 0,
    new: row.newCount || 0,
    saved: row.saved || 0,
  };
}

export function startScan(db) {
  const result = db.prepare("INSERT INTO scans (started_at) VALUES (?)").run(nowIso());
  return result.lastInsertRowid;
}

export function finishScan(db, id, summary) {
  db.prepare(
    `UPDATE scans SET finished_at = ?, queries_run = ?, urls_found = ?, deals_added = ?, deals_skipped = ?, error = ? WHERE id = ?`
  ).run(
    nowIso(),
    summary.queriesRun ?? 0,
    summary.urlsFound ?? 0,
    summary.dealsAdded ?? 0,
    summary.dealsSkipped ?? 0,
    summary.error || null,
    id
  );
  return latestScan(db);
}

export function latestScan(db) {
  const row = db.prepare("SELECT * FROM scans ORDER BY id DESC LIMIT 1").get();
  if (!row) return null;
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    queriesRun: row.queries_run,
    urlsFound: row.urls_found,
    dealsAdded: row.deals_added,
    dealsSkipped: row.deals_skipped,
    error: row.error,
  };
}

export function hasSeen(db, canonicalUrl) {
  return Boolean(db.prepare("SELECT canonical_url FROM seen_listings WHERE canonical_url = ?").get(canonicalUrl));
}
