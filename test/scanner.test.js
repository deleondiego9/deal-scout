import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, listDeals } from "../src/db.js";
import { runScan } from "../src/scanner.js";

const rssFixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "bing-rss.xml"),
  "utf8"
);

const htmlOnlyStorage = `<!DOCTYPE html><html><body><ol>
<li class="b_algo"><h2><a href="https://www.bizbuysell.com/business-opportunity/362-unit-self-storage-portfolio-semi-absentee-seller-financing/2521029/">362-Unit Self-Storage Portfolio Semi-Absentee, Seller Financing</a></h2>
<div class="b_caption"><p>Employees: 1 part-time. Seller Financing: Yes.</p></div></li>
</ol></body></html>`;

function mockFetch(html, rss) {
  return (input) => {
    const url = String(input);
    if (url.includes("format=rss")) {
      return Promise.resolve({ ok: true, status: 200, text: async () => rss });
    }
    if (url.includes("bing.com")) {
      return Promise.resolve({ ok: true, status: 200, text: async () => html });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      text: async () => "<html>anomaly captcha</html>",
    });
  };
}

describe("scan finds new listings instead of blackholing short snippets", () => {
  let dir;
  let db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "deal-scout-scan-"));
    db = openDb(join(dir, "deals.sqlite"));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds a listing once RSS provides the real-estate snippet", async () => {
    const first = await runScan(db, {
      queries: ['site:bizbuysell.com "seller financing"'],
      fetchImpl: mockFetch(htmlOnlyStorage, "<rss></rss>"),
      delayMs: 0,
      maxResults: 10,
      requireBoth: true,
    });
    assert.equal(first.dealsAdded, 0);
    assert.equal(listDeals(db).length, 0);

    const second = await runScan(db, {
      queries: ['site:bizbuysell.com "seller financing"'],
      fetchImpl: mockFetch(htmlOnlyStorage, rssFixture),
      delayMs: 0,
      maxResults: 10,
      requireBoth: true,
    });
    assert.ok(second.dealsAdded >= 1);
    const deals = listDeals(db);
    assert.ok(deals.some((deal) => deal.url.includes("2521029")));
  });

  it("does not insert the same listing twice on a later scan", async () => {
    const fetchImpl = mockFetch("<html></html>", rssFixture);
    const first = await runScan(db, {
      queries: ['site:bizbuysell.com "seller financing"'],
      fetchImpl,
      delayMs: 0,
      maxResults: 10,
    });
    const count = listDeals(db).length;
    assert.ok(first.dealsAdded >= 1);
    const second = await runScan(db, {
      queries: ['site:bizbuysell.com "seller financing"'],
      fetchImpl,
      delayMs: 0,
      maxResults: 10,
    });
    assert.equal(second.dealsAdded, 0);
    assert.equal(listDeals(db).length, count);
  });

  it("counts listings that do not mention both filters as unqualified, not skipped", async () => {
    const html = `<!DOCTYPE html><html><body>
<div class="result__body">
  <a class="result__a" href="https://www.bizbuysell.com/business-opportunity/laundromat-real-estate-included/2530156/">Laundromat Real Estate Included</a>
  <a class="result__snippet">Fully absentee laundromat. Real estate included. Asking $800,000.</a>
</div>
<div class="result__body">
  <a class="result__a" href="https://www.bizbuysell.com/business-opportunity/italian-restaurant-real-estate-included-some-seller-financing/2418402/">Italian Restaurant</a>
  <a class="result__snippet">Real estate included. Some seller financing. Lake County, FL.</a>
</div>
</body></html>`;
    const fetchImpl = (input) => {
      const url = String(input);
      if (url.includes("duckduckgo")) {
        return Promise.resolve({ ok: true, status: 200, text: async () => html });
      }
      return Promise.resolve({ ok: true, status: 200, text: async () => "<rss></rss>" });
    };
    const summary = await runScan(db, {
      queries: ['site:bizbuysell.com "real estate included"'],
      fetchImpl,
      delayMs: 0,
      maxResults: 10,
      requireBoth: true,
    });
    assert.equal(summary.dealsAdded, 1);
    assert.equal(summary.dealsUnqualified, 1);
    assert.equal(listDeals(db).length, 1);
  });

  it("Scan now pulls BizBuySell and LoopNet through Jina when DuckDuckGo is blocked", async () => {
    const html = `<!DOCTYPE html><html><body>
<div class="result__body">
  <a class="result__a" href="https://www.bizbuysell.com/business-opportunity/italian-restaurant-real-estate-included-some-seller-financing/2418402/">Italian Restaurant, Real Estate Included, Some Seller Financing</a>
  <a class="result__snippet">Lake County, FL. Real estate included. Some seller financing.</a>
</div>
<div class="result__body">
  <a class="result__a" href="https://www.loopnet.com/Listing/400-N-Ervay-Dallas-TX/39588558/">Dallas Multifamily Seller Financing</a>
  <a class="result__snippet">This multifamily property offers seller financing.</a>
</div>
<div class="result__body">
  <a class="result__a" href="https://www.loopnet.com/Listing/Vacant-Pad-Anniston-AL/24425485/">Anniston potential site owner financing</a>
  <a class="result__snippet">Vacant land potential site. Owner financing available.</a>
</div>
</body></html>`;
    const fetchImpl = (input) => {
      const url = String(input);
      if (url.includes("r.jina.ai") && url.includes("duckduckgo")) {
        return Promise.resolve({ ok: true, status: 200, text: async () => html });
      }
      if (url.includes("duckduckgo")) {
        return Promise.resolve({ ok: true, status: 202, text: async () => "anomaly" });
      }
      if (url.includes("bing.com")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => "<html><body><ol><li class=\"b_algo\"><h2><a href=\"https://www.dictionary.com/browse/owner\">owner</a></h2></li></ol></body></html>",
        });
      }
      return Promise.resolve({ ok: true, status: 200, text: async () => "<rss></rss>" });
    };
    const summary = await runScan(db, {
      queries: [
        'site:bizbuysell.com "seller financing" "real estate included"',
        'site:loopnet.com/Listing "seller financing"',
      ],
      fetchImpl,
      delayMs: 0,
      maxResults: 10,
      requireBoth: true,
    });
    assert.ok(summary.urlsFound >= 3, `expected marketplace URLs, got ${summary.urlsFound}`);
    assert.equal(summary.dealsAdded, 2);
    assert.equal(summary.dealsUnqualified, 1);
    const deals = listDeals(db);
    assert.ok(deals.some((deal) => deal.url.includes("bizbuysell.com")));
    assert.ok(deals.some((deal) => deal.url.includes("39588558")));
    assert.equal(
      deals.some((deal) => deal.url.includes("24425485")),
      false
    );
  });
});
