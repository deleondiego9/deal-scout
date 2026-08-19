import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, listDeals } from "../src/db.js";
import { createApp } from "../src/server.js";

const fixtureHtml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "ddg-search.html"),
  "utf8"
);

function mockFetch(input) {
  const url = String(input);
  if (url.includes("duckduckgo.com")) {
    return Promise.resolve({
      ok: true,
      status: 200,
      text: async () => fixtureHtml,
    });
  }
  return Promise.resolve({
    ok: false,
    status: 403,
    text: async () => "Access Denied",
  });
}

describe("http api", () => {
  let dir;
  let db;
  let server;
  let base;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "deal-scout-api-"));
    db = openDb(join(dir, "deals.sqlite"));
    const app = createApp(db, {
      apiKey: "test-key",
      fetchImpl: mockFetch,
      queries: ['site:bizbuysell.com "seller financing" "real estate included"'],
      scanRequireBoth: true,
      scanDelayMs: 0,
      scanMaxResults: 10,
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    base = `http://127.0.0.1:${address.port}`;
  });

  after(() => {
    server.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function req(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const response = await fetch(`${base}${path}`, { ...options, headers });
    const body = await response.json();
    return { status: response.status, body };
  }

  it("serves health and empty deal list", async () => {
    const health = await req("/api/health");
    assert.equal(health.body.ok, true);
    const deals = await req("/api/deals");
    assert.deepEqual(deals.body.deals, []);
  });

  it("serves the phone-install manifest and icons", async () => {
    const manifestRes = await fetch(`${base}/manifest.json`);
    const manifest = await manifestRes.json();
    assert.equal(manifestRes.status, 200);
    assert.equal(manifest.display, "standalone");
    assert.ok(manifest.icons.length >= 2);
    const icon = await fetch(`${base}/icons/icon-192.png`);
    assert.equal(icon.status, 200);
    assert.match(icon.headers.get("content-type") || "", /image\/png/);
    const sw = await fetch(`${base}/sw.js`);
    assert.equal(sw.status, 200);
    assert.match(sw.headers.get("cache-control") || "", /no-cache/);
  });

  it("serves the board without an API key box", async () => {
    const res = await fetch(`${base}/`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.equal(html.includes('id="api-key"'), false);
    assert.match(html, /Scan now/);
    assert.match(html, /id="clear-dismissed"/);
    assert.match(res.headers.get("cache-control") || "", /no-cache/);
    const js = await fetch(`${base}/app.js`);
    const appJs = await js.text();
    assert.match(appJs, /JSON\.stringify\(\{ notes:/);
    assert.match(appJs, /data-save-notes/);
    assert.match(appJs, /data-clear/);
    assert.equal(appJs.includes("filterForDeal"), false);
  });

  it("rejects ingest without an API key", async () => {
    const result = await req("/api/deals", {
      method: "POST",
      body: JSON.stringify({ url: "https://www.bizbuysell.com/business-opportunity/x/123456/" }),
    });
    assert.equal(result.status, 401);
  });

  it("ingests a deal from an agent payload", async () => {
    const result = await req("/api/deals", {
      method: "POST",
      headers: { "X-API-Key": "test-key" },
      body: JSON.stringify({
        url: "https://www.bizbuysell.com/business-opportunity/food-market/2541327/",
        title: "Seller Financing | Food Market + Real Estate",
        description: "Real estate included. Seller financing offered.",
        location: "Austin, TX",
      }),
    });
    assert.equal(result.status, 201);
    assert.equal(result.body.inserted, true);
    assert.equal(result.body.deal.qualified, true);
  });

  it("does not duplicate the same ingested URL", async () => {
    const result = await req("/api/deals", {
      method: "POST",
      headers: { "X-API-Key": "test-key" },
      body: JSON.stringify({
        url: "https://www.bizbuysell.com/business-opportunity/food-market/2541327/",
        title: "Seller Financing | Food Market + Real Estate",
        description: "Real estate included. Seller financing offered.",
      }),
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.repeated, true);
  });

  it("runs a scan without an API key and skips repeats on the second run", async () => {
    const first = await req("/api/scan", {
      method: "POST",
      body: "{}",
    });
    assert.equal(first.status, 200);
    assert.ok(first.body.summary.dealsAdded >= 3);
    const countAfterFirst = listDeals(db).length;

    const second = await req("/api/scan", {
      method: "POST",
      body: "{}",
    });
    assert.equal(second.body.summary.dealsAdded, 0);
    assert.ok(second.body.summary.dealsSkipped >= 3);
    assert.equal(listDeals(db).length, countAfterFirst);
  });

  it("updates deal status", async () => {
    const deals = await req("/api/deals?status=all");
    const id = deals.body.deals[0].id;
    const patched = await req(`/api/deals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "saved" }),
    });
    assert.equal(patched.body.deal.status, "saved");
  });

  it("saves notes and marks a deal as called", async () => {
    const deals = await req("/api/deals?status=new");
    const id = deals.body.deals[0].id;
    const noted = await req(`/api/deals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ notes: "Left voicemail with broker Jane" }),
    });
    assert.equal(noted.status, 200);
    assert.equal(noted.body.deal.notes, "Left voicemail with broker Jane");
    assert.equal(noted.body.deal.called, false);
    assert.equal(noted.body.deal.status, "new");
    const stillNew = await req("/api/deals?status=new");
    assert.ok(stillNew.body.deals.some((deal) => deal.id === id));

    const strayDismiss = await req(`/api/deals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ notes: "still new", status: "dismissed" }),
    });
    assert.equal(strayDismiss.body.deal.status, "new");
    assert.equal(strayDismiss.body.deal.notes, "still new");

    const called = await req(`/api/deals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ called: true }),
    });
    assert.equal(called.body.deal.called, true);
    assert.ok(called.body.deal.calledAt);
    assert.equal(called.body.deal.notes, "still new");

    const listed = await req("/api/deals?status=called");
    assert.ok(listed.body.deals.some((deal) => deal.id === id));

    const stats = await req("/api/stats");
    assert.ok(stats.body.stats.called >= 1);
  });

  it("imports harvested listings with an API key", async () => {
    const result = await req("/api/scan/import", {
      method: "POST",
      headers: { "X-API-Key": "test-key" },
      body: JSON.stringify({
        origin: "github-harvest",
        listings: [
          {
            url: "https://www.bizbuysell.com/business-opportunity/spokane-auto-shop-for-sale-with-real-estate-seller-financing/2528518/",
            title: "Spokane Auto Shop with Real Estate + Seller Financing",
            snippet: "Seller financing available. Real estate included.",
          },
        ],
      }),
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.summary.dealsAdded, 1);
    assert.ok(listDeals(db).some((deal) => deal.url.includes("2528518")));
  });

  it("dismisses a deal until it is cleared, and notes do not dismiss it", async () => {
    const deals = await req("/api/deals?status=new");
    const id = deals.body.deals.find((deal) => deal.status === "new").id;
    const dismissed = await req(`/api/deals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "dismissed" }),
    });
    assert.equal(dismissed.body.deal.status, "dismissed");
    const parked = await req("/api/deals?status=dismissed");
    assert.ok(parked.body.deals.some((deal) => deal.id === id));

    const noted = await req(`/api/deals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ notes: "still parked" }),
    });
    assert.equal(noted.body.deal.status, "dismissed");
    assert.equal(noted.body.deal.notes, "still parked");
    const stillParked = await req("/api/deals?status=dismissed");
    assert.ok(stillParked.body.deals.some((deal) => deal.id === id));

    const restored = await req(`/api/deals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "new" }),
    });
    assert.equal(restored.body.deal.status, "new");
    await req(`/api/deals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "dismissed" }),
    });

    const cleared = await req(`/api/deals/${id}`, { method: "DELETE" });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.deleted, true);
    const gone = await req("/api/deals?status=dismissed");
    assert.equal(gone.body.deals.some((deal) => deal.id === id), false);
  });

  it("clears all dismissed deals in one request", async () => {
    const deals = await req("/api/deals?status=all");
    const id = deals.body.deals.find((deal) => deal.status !== "dismissed").id;
    await req(`/api/deals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "dismissed" }),
    });
    const result = await req("/api/deals/dismissed", { method: "DELETE" });
    assert.equal(result.status, 200);
    assert.ok(result.body.deleted >= 1);
    const parked = await req("/api/deals?status=dismissed");
    assert.equal(parked.body.deals.length, 0);
  });
});
