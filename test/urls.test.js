import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canonicalizeUrl, decodeBingUrl, decodeDuckDuckGoUrl, isListingUrl, listingFingerprint, listingKey, sourceFromUrl } from "../src/urls.js";

describe("urls", () => {
  it("unwraps Bing redirect links", () => {
    const href =
      "https://www.bing.com/ck/a?!&&p=abc&u=a1aHR0cHM6Ly93d3cuYml6YnV5c2VsbC5jb20vYnVzaW5lc3Mtb3Bwb3J0dW5pdHkvaXRhbGlhbi1yZXN0YXVyYW50LXJlYWwtZXN0YXRlLWluY2x1ZGVkLXNvbWUtc2VsbGVyLWZpbmFuY2luZy8yNDE4NDAyLw";
    assert.match(decodeBingUrl(href), /bizbuysell\.com\/business-opportunity\/italian-restaurant/);
    assert.equal(
      canonicalizeUrl(href),
      "https://www.bizbuysell.com/business-opportunity/italian-restaurant-real-estate-included-some-seller-financing/2418402"
    );
  });
  it("unwraps DuckDuckGo redirect links", () => {
    const href =
      "//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.bizbuysell.com%2Fbusiness-opportunity%2Fcar-wash%2F2512479%2F&rut=abc";
    assert.equal(
      decodeDuckDuckGoUrl(href),
      "https://www.bizbuysell.com/business-opportunity/car-wash/2512479/"
    );
  });

  it("canonicalizes tracking params and trailing slashes", () => {
    const url =
      "https://WWW.BizBuySell.com/business-opportunity/car-wash/2512479/?utm_source=x&utm_medium=y";
    assert.equal(
      canonicalizeUrl(url),
      "https://www.bizbuysell.com/business-opportunity/car-wash/2512479"
    );
  });

  it("normalizes mobile hosts to www", () => {
    assert.equal(
      canonicalizeUrl("https://m.bizbuysell.com/business-opportunity/car-wash/2512479/"),
      "https://www.bizbuysell.com/business-opportunity/car-wash/2512479"
    );
  });

  it("accepts marketplace listing URLs and skips articles", () => {
    assert.equal(
      isListingUrl(
        "https://www.bizbuysell.com/business-opportunity/italian-restaurant-real-estate-included-some-seller-financing/2418402/"
      ),
      true
    );
    assert.equal(
      isListingUrl("https://www.bizbuysell.com/learning-center/article/what-is-seller-financing/"),
      false
    );
    assert.equal(isListingUrl("https://example.com/business-opportunity/123456/"), false);
  });

  it("labels known sources", () => {
    assert.equal(
      sourceFromUrl("https://www.bizbuysell.com/business-opportunity/x/1"),
      "BizBuySell"
    );
  });

  it("builds a stable fingerprint", () => {
    assert.equal(
      listingFingerprint("Car Wash + Real Estate", "Pomeroy, OH", 1000000),
      listingFingerprint("car wash + real estate", "Pomeroy, OH", 1000000)
    );
  });

  it("treats the same marketplace listing ID as one key even when the slug changes", () => {
    assert.equal(
      listingKey(
        "https://www.bizbuysell.com/business-opportunity/established-car-wash-real-estate/2512479/"
      ),
      listingKey("https://m.bizbuysell.com/business-opportunity/car-wash/2512479?utm_source=bing")
    );
    assert.equal(listingKey("https://www.bizbuysell.com/business-opportunity/car-wash/2512479"), "bizbuysell.com:2512479");
  });
});
