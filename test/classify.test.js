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
