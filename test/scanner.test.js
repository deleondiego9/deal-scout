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
});
