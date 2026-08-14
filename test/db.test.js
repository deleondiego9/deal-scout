import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertDeal, findDealByUrl, listDeals } from "../src/db.js";
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
});
