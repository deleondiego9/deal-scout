import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBingHtml, parseBingRss, parseDuckDuckGoHtml } from "../src/search.js";
import { extractFromSearchResult } from "../src/extract.js";
import { isListingUrl } from "../src/urls.js";

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "ddg-search.html"),
  "utf8"
);

const bingFixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "bing-search.html"),
  "utf8"
);

const bingRssFixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "bing-rss.xml"),
  "utf8"
);

describe("search parsing", () => {
  it("extracts listing URLs, titles, and snippets from DuckDuckGo HTML", () => {
    const results = parseDuckDuckGoHtml(fixture);
    assert.ok(results.length >= 4);
    assert.equal(
      results[0].title,
      "Italian Restaurant, Real Estate Included, Some Seller Financing"
    );
    assert.ok(results[0].url.includes("bizbuysell.com/business-opportunity/"));
    assert.ok(results.every((item) => isListingUrl(item.url)));
  });

  it("classifies search snippets without fetching the listing page", () => {
    const results = parseDuckDuckGoHtml(fixture);
    const extracted = extractFromSearchResult(results[0]);
    assert.equal(extracted.qualified, true);
    assert.equal(extracted.location, "Lake County, FL");
    assert.equal(extracted.source, "BizBuySell");
  });

  it("extracts listing URLs from Bing redirect links", () => {
    const results = parseBingHtml(bingFixture);
    assert.equal(results.length, 1);
    assert.equal(
      results[0].url,
      "https://www.bizbuysell.com/business-opportunity/italian-restaurant-real-estate-included-some-seller-financing/2418402"
    );
    assert.match(results[0].title, /Italian Restaurant/i);
  });

  it("extracts listing URLs and richer snippets from Bing RSS", () => {
    const results = parseBingRss(bingRssFixture);
    assert.equal(results.length, 2);
    assert.equal(
      results[1].url,
      "https://www.bizbuysell.com/business-opportunity/362-unit-self-storage-portfolio-semi-absentee-seller-financing/2521029"
    );
    const extracted = extractFromSearchResult(results[1]);
    assert.equal(extracted.qualified, true);
    assert.equal(extracted.sellerFinancing, true);
    assert.equal(extracted.realEstateIncluded, true);
  });
});
