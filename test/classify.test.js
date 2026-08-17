import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classify, parseLocation, parsePrice } from "../src/classify.js";

describe("classify", () => {
  it("qualifies listings with seller financing and real estate included", () => {
    const result = classify(
      "Italian Restaurant, Real Estate Included, Some Seller Financing. Lake County, FL."
    );
    assert.equal(result.qualified, true);
    assert.equal(result.sellerFinancing, true);
    assert.equal(result.realEstateIncluded, true);
    assert.equal(result.score, 100);
  });

  it("treats w/Real Estate plus owner financing as qualified", () => {
    const result = classify(
      "NC Engineered Wood Component Manufacturing Facility w/Real Estate. Seller financing available."
    );
    assert.equal(result.qualified, true);
    assert.equal(result.sellerFinancing, true);
    assert.equal(result.realEstateIncluded, true);
  });

  it("accepts owner financing and plus-real-estate phrasing", () => {
    const result = classify(
      "Auto Repair Shop + Real Estate. Owner financing available. The business and real estate are offered together."
    );
    assert.equal(result.qualified, true);
    assert.ok(result.financingEvidence.length > 0);
    assert.ok(result.realEstateEvidence.length > 0);
  });

  it("rejects real estate that is not included", () => {
    const result = classify(
      "Profitable cafe with seller financing. Real estate not included; leased facility."
    );
    assert.equal(result.sellerFinancing, true);
    assert.equal(result.realEstateIncluded, false);
    assert.equal(result.qualified, false);
  });

  it("rejects cash-only listings", () => {
    const result = classify("Car wash with real estate included. Cash only. No seller financing.");
    assert.equal(result.sellerFinancing, false);
    assert.equal(result.qualified, false);
  });

  it("rejects vacant land and development sites even with owner financing", () => {
    const land = classify(
      "214 Raffel Rd - 8.7 Acre Development Site 0% Owner Financing. 8.67 Acres of Commercial Land Offered at $399,000 in Woodstock, IL."
    );
    assert.equal(land.sellerFinancing, true);
    assert.equal(land.landDeal, true);
    assert.equal(land.qualified, false);
  });

  it("keeps a business that includes land plus the building", () => {
    const result = classify(
      "Tucson #6 Bar - Real Estate Included. Owner financing available with 20% down. Land, building, and business included."
    );
    assert.equal(result.landDeal, false);
    assert.equal(result.qualified, true);
  });
});

describe("classify uses listing URL slugs", () => {
  it("reads seller-financing and real-estate-included from the path", async () => {
    const { extractFromSearchResult } = await import("../src/extract.js");
    const extracted = extractFromSearchResult({
      url: "https://www.bizbuysell.com/business-opportunity/italian-restaurant-real-estate-included-some-seller-financing/2418402/",
      title: "Italian restaurant",
      snippet: "Lake County listing on BizBuySell",
    });
    assert.equal(extracted.qualified, true);
    assert.equal(extracted.sellerFinancing, true);
    assert.equal(extracted.realEstateIncluded, true);
  });

  it("treats LoopNet /Listing/ pages as real estate when seller financing is offered", async () => {
    const { extractFromSearchResult } = await import("../src/extract.js");
    const extracted = extractFromSearchResult({
      url: "https://www.loopnet.com/Listing/5436-S-Broadway-Los-Angeles-CA/39992803/",
      title: "5436 S Broadway, Los Angeles, CA 90037 - SELLER FINANCING",
      snippet: "BELOW MARKET SELLER FINANCING AT ONLY 4% FIXED INTEREST ONLY!!! This Retail property is available for sale.",
    });
    assert.equal(extracted.source, "LoopNet");
    assert.equal(extracted.sellerFinancing, true);
    assert.equal(extracted.realEstateIncluded, true);
    assert.equal(extracted.qualified, true);
  });

  it("rejects LoopNet land-only development sites", async () => {
    const { extractFromSearchResult } = await import("../src/extract.js");
    const extracted = extractFromSearchResult({
      url: "https://www.loopnet.com/Listing/214-Raffel-Rd-Woodstock-IL/35100018/",
      title: "214 Raffel Rd - 8.7 Acre Development Site 0% Owner Financing",
      snippet:
        "8.67 Acres of Commercial Land Offered at $399,000 in Woodstock, IL 60098. Owner financing.",
    });
    assert.equal(extracted.sellerFinancing, true);
    assert.equal(extracted.landDeal, true);
    assert.equal(extracted.qualified, false);
  });

  it("does not assume real estate for LoopNet business-opportunity ads", async () => {
    const { extractFromSearchResult } = await import("../src/extract.js");
    const extracted = extractFromSearchResult({
      url: "https://www.loopnet.com/biz/business-opportunity/cabinet-sales-assembly-and-distribution-1-3rd-seller-financing/2174360",
      title: "Scalable Stretch & Recovery Franchise",
      snippet: "Seller financing available. Low-cost franchise in a growth market.",
    });
    assert.equal(extracted.sellerFinancing, true);
    assert.equal(extracted.realEstateIncluded, false);
    assert.equal(extracted.qualified, false);
  });
});

describe("parsePrice", () => {
  it("parses comma-formatted dollars", () => {
    assert.equal(parsePrice("Offered at $1,000,000 for the business"), 1_000_000);
  });

  it("parses compact millions", () => {
    assert.equal(parsePrice("Asking $1.2M"), 1_200_000);
  });
});

describe("parseLocation", () => {
  it("reads city-state prefixes from snippets", () => {
    assert.equal(parseLocation("Pomeroy, OH: Own a fully operational car wash"), "Pomeroy, OH");
    assert.equal(parseLocation("Lake County, FL: Step into ownership"), "Lake County, FL");
  });
});
