import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  daysOnMarket,
  earlierListedAt,
  listedAtFromDaysOnMarket,
  listedAtFromInput,
  parseDateToIso,
  parseListedAt,
} from "../src/listed.js";
import { extractFromHtml, extractFromSearchResult } from "../src/extract.js";

const now = new Date("2026-08-19T12:00:00.000Z");

describe("days on market parsing", () => {
  it("reads explicit day counts from marketplace phrasing", () => {
    assert.equal(daysOnMarket(parseListedAt("Seller financing. 214 days on market.", now), now), 214);
    assert.equal(daysOnMarket(parseListedAt("Days on LoopNet: 40", now), now), 40);
    assert.equal(daysOnMarket(parseListedAt("Listed 12 days ago. Real estate included.", now), now), 12);
    assert.equal(daysOnMarket(parseListedAt("On market for 7 days", now), now), 7);
    assert.equal(daysOnMarket(parseListedAt("DOM: 90", now), now), 90);
  });

  it("reads labeled listed dates", () => {
    const listed = parseListedAt("Date listed: March 1, 2026. Seller financing available.", now);
    assert.equal(parseDateToIso(listed), "2026-03-01T00:00:00.000Z");
    assert.equal(daysOnMarket(listed, now), 171);
    assert.equal(
      parseDateToIso(parseListedAt("Listed on 2026-06-10. Real estate included.", now)),
      "2026-06-10T00:00:00.000Z"
    );
  });

  it("does not treat Bing snippet stamps or year-built as listed dates", () => {
    assert.equal(parseListedAt("Apr 1, 2026 · BELOW MARKET SELLER FINANCING AT ONLY 4%", now), null);
    assert.equal(parseListedAt("Seller Financing Available | Built 2026 - Los Angeles, CA", now), null);
    assert.equal(parseListedAt("Employees: 1 part-time. Seller Financing: Yes.", now), null);
  });

  it("computes days from a stored listed_at and keeps the earlier date", () => {
    const fromDays = listedAtFromDaysOnMarket(10, now);
    assert.equal(daysOnMarket(fromDays, now), 10);
    assert.equal(
      earlierListedAt("2026-02-01", "2026-04-01"),
      "2026-02-01T00:00:00.000Z"
    );
  });

  it("extracts listed dates from search snippets onto deals", () => {
    const extracted = extractFromSearchResult({
      url: "https://www.loopnet.com/Listing/Example-Rd-Atlanta-GA/39999999",
      title: "Retail with Seller Financing",
      snippet: "Owner financing. 45 days on market. Real estate included.",
    });
    assert.equal(extracted.qualified, true);
    const days = daysOnMarket(extracted.listedAt);
    assert.ok(days >= 44 && days <= 46, `daysOnMarket=${days}`);
  });

  it("reads JSON-LD datePosted from listing HTML", () => {
    const extracted = extractFromHtml(
      `<html><head>
        <script type="application/ld+json">{"@type":"Offer","price":"500000","datePosted":"2026-05-01"}</script>
        <script type="application/ld+json">{"@type":"Product","name":"Shop","description":"Seller financing. Real estate included."}</script>
      </head><body><h1>Shop with Real Estate</h1></body></html>`,
      "https://www.bizbuysell.com/business-opportunity/shop/2550999/"
    );
    assert.equal(parseDateToIso(extracted.listedAt), "2026-05-01T00:00:00.000Z");
  });

  it("accepts listedAt on ingest payloads", () => {
    const listed = listedAtFromInput({ listedAt: "2026-07-01", title: "Shop" }, now);
    assert.equal(parseDateToIso(listed), "2026-07-01T00:00:00.000Z");
    assert.equal(daysOnMarket(listedAtFromInput({ daysOnMarket: 3 }, now), now), 3);
  });
});
