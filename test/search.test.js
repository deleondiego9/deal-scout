import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectListingResults,
  parseBingHtml,
  parseBingRss,
  parseDuckDuckGoHtml,
  parseDuckDuckGoLite,
  parseGenericListingText,
  searchBing,
  searchDuckDuckGo,
  titleFromListingUrl,
} from "../src/search.js";
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

  it("extracts listing URLs from DuckDuckGo lite HTML", () => {
    const lite = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "ddg-lite.html"),
      "utf8"
    );
    const results = parseDuckDuckGoLite(lite);
    assert.equal(results.length, 1);
    assert.ok(results[0].url.includes("2473314"));
    assert.match(results[0].snippet, /Seller Financing/i);
    const extracted = extractFromSearchResult(results[0]);
    assert.equal(extracted.qualified, true);
  });

  it("humanizes listing slugs into titles", () => {
    assert.match(
      titleFromListingUrl(
        "https://www.bizbuysell.com/business-opportunity/italian-restaurant-real-estate-included-some-seller-financing/2418402/"
      ),
      /Italian Restaurant/i
    );
  });

  it("extracts marketplace URLs from reader markdown when HTML parse is empty", () => {
    const markdown = `
Title: LoopNet listing

[Retail Plaza Seller Financing](https://www.loopnet.com/Listing/123-Main-St-Dallas-TX/39992803/)
https://www.bizbuysell.com/business-opportunity/car-wash-real-estate-included-seller-financing/2473314/
`;
    const results = parseGenericListingText(markdown);
    assert.equal(results.length, 2);
    assert.ok(results.some((item) => item.url.includes("loopnet.com/Listing")));
    assert.ok(results.some((item) => item.url.includes("bizbuysell.com/business-opportunity")));
  });

  it("does not send a browser User-Agent to the reader", async () => {
    const fetchImpl = async (input, init = {}) => {
      const href = String(input);
      const ua = init.headers?.["User-Agent"] || "";
      if (href.includes("r.jina.ai")) {
        if (/Chrome\/\d/i.test(ua)) {
          return { ok: false, status: 403, text: async () => "blocked" };
        }
        return { ok: true, status: 200, text: async () => fixture };
      }
      return { ok: true, status: 202, text: async () => "anomaly" };
    };
    const results = await searchDuckDuckGo('site:loopnet.com/Listing "seller financing"', { fetchImpl });
    assert.ok(results.length >= 4);
    assert.ok(results.every((item) => isListingUrl(item.url)));
  });

  it("retries DuckDuckGo through Jina when the direct HTML is blocked", async () => {
    const fetchImpl = async (input) => {
      const href = String(input);
      if (href.includes("r.jina.ai")) {
        return { ok: true, status: 200, text: async () => fixture };
      }
      if (href.includes("allorigins")) {
        throw new Error("allorigins should not run after Jina succeeds");
      }
      return { ok: true, status: 202, text: async () => "anomaly" };
    };
    const results = await searchDuckDuckGo('site:bizbuysell.com "seller financing"', {
      fetchImpl,
    });
    assert.ok(results.length >= 4);
    assert.ok(results.every((item) => isListingUrl(item.url)));
    assert.ok(results[0].url.includes("bizbuysell.com/business-opportunity/"));
  });

  it("parses LoopNet URLs from Jina markdown when DuckDuckGo returns 202", async () => {
    const markdown = `[Seller financed multifamily](https://www.loopnet.com/Listing/400-N-Ervay-Dallas-TX/39588558/)
[Owner financed retail](https://www.loopnet.com/Listing/Retail-Woodstock-GA/39993021/)
https://www.bizbuysell.com/business-opportunity/italian-restaurant-real-estate-included-some-seller-financing/2418402/`;
    const fetchImpl = async (input) => {
      const href = String(input);
      if (href.includes("r.jina.ai") && href.includes("duckduckgo")) {
        return { ok: true, status: 200, text: async () => markdown };
      }
      return { ok: true, status: 202, text: async () => "anomaly captcha" };
    };
    const results = await collectListingResults(
      ['site:loopnet.com/Listing "seller financing"', 'site:bizbuysell.com "seller financing"'],
      { fetchImpl, searchDelayMs: 0 }
    );
    assert.ok(results.some((item) => item.url.includes("39588558")));
    assert.ok(results.some((item) => item.url.includes("bizbuysell.com/business-opportunity")));
  });

  it("does not proxy Bing HTML that already rendered result cards", async () => {
    const junk = `<html><body><ol>
<li class="b_algo"><h2><a href="https://www.dictionary.com/browse/owner">owner</a></h2><p>definition</p></li>
</ol></body></html>`;
    const fetchImpl = async (input) => {
      const href = String(input);
      if (href.includes("r.jina.ai") || href.includes("allorigins")) {
        throw new Error(`unexpected proxy for ${href}`);
      }
      if (href.includes("bing.com")) {
        return { ok: true, status: 200, text: async () => junk };
      }
      return { ok: true, status: 202, text: async () => "anomaly" };
    };
    const results = await searchBing('site:loopnet.com "seller financing"', { fetchImpl });
    assert.equal(results.length, 0);
  });

  it("does not wait on allorigins after Jina returns an empty DuckDuckGo page", async () => {
    const emptyDdg = `<html><body>
      <div class="result__body"><a class="result__a" href="https://example.com/x">Unrelated</a></div>
    </body></html>`;
    const fetchImpl = async (input) => {
      const href = String(input);
      if (href.includes("allorigins") || href.includes("lite.duckduckgo")) {
        throw new Error(`unexpected extra fetch ${href}`);
      }
      if (href.includes("r.jina.ai")) {
        return { ok: true, status: 200, text: async () => emptyDdg };
      }
      return { ok: true, status: 202, text: async () => "anomaly" };
    };
    const results = await searchDuckDuckGo('site:bizquest.com "seller financing"', { fetchImpl });
    assert.equal(results.length, 0);
  });
});
