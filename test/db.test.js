import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb, upsertDeal, findDealByUrl, listDeals, updateDeal, hasSeen, recordSkip, getDeal } from "../src/db.js";
import { ingestDeal } from "../src/scanner.js";

let dir;
let db;

describe("database dedupe", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "deal-scout-"));
    db = openDb(join(dir, "deals.sqlite"));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("inserts a deal once and treats the same URL as a repeat", () => {
    const payload = {
      canonicalUrl: "https://www.bizbuysell.com/business-opportunity/car-wash/2512479",
      title: "Established Car Wash + Real Estate",
      location: "Pomeroy, OH",
      priceAmount: 1_000_000,
      sellerFinancing: true,
      realEstateIncluded: true,
      qualified: true,
      score: 100,
      origin: "scan",
    };
    const first = upsertDeal(db, payload);
    const second = upsertDeal(db, { ...payload, title: "Short" });
    assert.equal(first.inserted, true);
    assert.equal(second.inserted, false);
    assert.equal(second.repeated, true);
    assert.equal(listDeals(db).length, 1);
    assert.equal(
      findDealByUrl(db, payload.canonicalUrl).title,
      "Established Car Wash + Real Estate"
    );
  });

  it("dedupes agent ingest by canonical URL", () => {
    const body = {
      url: "https://www.bizbuysell.com/business-opportunity/italian-restaurant-real-estate-included-some-seller-financing/2418402/",
      title: "Italian Restaurant, Real Estate Included, Some Seller Financing",
      description: "Lake County, FL: seller financing and real estate included.",
    };
    const first = ingestDeal(db, body);
    const second = ingestDeal(db, body);
    assert.equal(first.inserted, true);
    assert.equal(second.repeated, true);
    assert.equal(first.deal.qualified, true);
  });

  it("does not unqualify a deal when a thinner duplicate is posted", () => {
    const url =
      "https://www.bizbuysell.com/business-opportunity/italian-restaurant-real-estate-included-some-seller-financing/2418402/";
    ingestDeal(db, {
      url,
      title: "Italian Restaurant, Real Estate Included, Some Seller Financing",
      description: "Lake County, FL: seller financing and real estate included.",
    });
    const again = ingestDeal(db, { url, title: "Italian Restaurant" });
    assert.equal(again.repeated, true);
    assert.equal(again.deal.qualified, true);
    assert.equal(again.deal.sellerFinancing, true);
    assert.equal(
      again.deal.title,
      "Italian Restaurant, Real Estate Included, Some Seller Financing"
    );
  });

  it("does not qualify a land-only listing on upsert", () => {
    const url = "https://www.loopnet.com/Listing/214-Raffel-Rd-Woodstock-IL/35100018/";
    const first = ingestDeal(db, {
      url,
      title: "8.7 Acre Development Site 0% Owner Financing",
      description: "8.67 Acres of Commercial Land Offered at $399,000. Owner financing.",
    });
    assert.equal(first.deal.qualified, false);
    assert.equal(first.deal.sellerFinancing, true);
  });

  it("stores notes and called without losing them on a later scan upsert", () => {
    const payload = {
      canonicalUrl: "https://www.bizbuysell.com/business-opportunity/notes-test/2550001",
      title: "Shop + Real Estate Seller Financing",
      location: "Austin, TX",
      priceAmount: 500_000,
      sellerFinancing: true,
      realEstateIncluded: true,
      qualified: true,
      score: 100,
    };
    const created = upsertDeal(db, payload);
    const updated = updateDeal(db, created.deal.id, {
      notes: "Called owner. Will send P&L.",
      called: true,
    });
    assert.equal(updated.called, true);
    assert.equal(updated.notes, "Called owner. Will send P&L.");
    const again = upsertDeal(db, payload);
    assert.equal(again.deal.notes, "Called owner. Will send P&L.");
    assert.equal(again.deal.called, true);
    assert.equal(listDeals(db, { status: "called" }).length, 1);
    assert.equal(listDeals(db, { status: "new" }).length, 0);
  });

  it("dedupes the same marketplace listing ID even when the URL slug changes", () => {
    const first = upsertDeal(db, {
      canonicalUrl: "https://www.bizbuysell.com/business-opportunity/established-car-wash/2512479",
      title: "Established Car Wash + Real Estate",
      location: "Pomeroy, OH",
      priceAmount: 1_000_000,
      sellerFinancing: true,
      realEstateIncluded: true,
      qualified: true,
      score: 100,
    });
    const second = upsertDeal(db, {
      canonicalUrl: "https://www.bizbuysell.com/business-opportunity/car-wash-seller-financing/2512479",
      title: "Car Wash Seller Financing",
      location: "Pomeroy, OH",
      priceAmount: 1_000_000,
      sellerFinancing: true,
      realEstateIncluded: true,
      qualified: true,
      score: 80,
    });
    assert.equal(first.inserted, true);
    assert.equal(second.inserted, false);
    assert.equal(listDeals(db).length, 1);
    assert.equal(hasSeen(db, "https://m.bizbuysell.com/business-opportunity/other-slug/2512479"), true);
  });

  it("bumps last_seen_at when a later scan skips an existing listing", async () => {
    const created = upsertDeal(db, {
      canonicalUrl: "https://www.bizbuysell.com/business-opportunity/shop/2432174",
      title: "Auto Shop + Real Estate",
      location: "Austin, TX",
      priceAmount: 500_000,
      sellerFinancing: true,
      realEstateIncluded: true,
      qualified: true,
    });
    const before = created.deal.lastSeenAt;
    await new Promise((resolve) => setTimeout(resolve, 15));
    recordSkip(db, { canonicalUrl: created.deal.url });
    const after = getDeal(db, created.deal.id);
    assert.ok(after.lastSeenAt > before);
  });

  it("migrates an existing database that lacks notes and called columns", () => {
    const file = join(dir, "legacy.sqlite");
    const legacy = new DatabaseSync(file);
    legacy.exec(`
      CREATE TABLE deals (
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
    `);
    legacy.prepare(
      "INSERT INTO deals (canonical_url, title, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)"
    ).run("https://example.com/listing/1", "Legacy listing", "2026-01-01", "2026-01-01");
    legacy.close();

    const migrated = openDb(file);
    const deal = listDeals(migrated, { status: "all" })[0];
    assert.equal(deal.title, "Legacy listing");
    assert.equal(deal.notes, "");
    assert.equal(deal.called, false);
    const updated = updateDeal(migrated, deal.id, { notes: "hello", called: true });
    assert.equal(updated.notes, "hello");
    assert.equal(updated.called, true);
    migrated.close();
  });
});
