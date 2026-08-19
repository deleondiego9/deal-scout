import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, getDeal, listDeals } from "../src/db.js";
import { ingestSearchListings } from "../src/scanner.js";
import { createApp } from "../src/server.js";

const root = dirname(fileURLToPath(import.meta.url));

describe("board actions affected by notes, dismiss, and clear", () => {
  let dir;
  let db;
  let server;
  let base;
  let ids;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "deal-scout-board-"));
    db = openDb(join(dir, "deals.sqlite"));
    const app = createApp(db, {
      apiKey: "test-key",
      fetchImpl: async () => ({ ok: false, status: 403, text: async () => "" }),
      scanRequireBoth: true,
      scanDelayMs: 0,
      scanMaxResults: 10,
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    ids = {};
  });

  after(() => {
    server.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function req(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const response = await fetch(`${base}${path}`, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  }

  let nextListingId = 9000100;

  async function ingest(slug, extra = {}) {
    const listingId = nextListingId++;
    const result = await req("/api/deals", {
      method: "POST",
      headers: { "X-API-Key": "test-key" },
      body: JSON.stringify({
        url: `https://www.bizbuysell.com/business-opportunity/${slug}/${listingId}/`,
        title: `${extra.title || slug} Seller Financing Real Estate`,
        description: "Seller financing available. Real estate included.",
        location: extra.location || "Atlanta, GA",
      }),
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body.deal;
  }

  it("phone UI keeps Save notes off the Dismiss row and offers Clear on dismissed", async () => {
    const html = await (await fetch(`${base}/`)).text();
    assert.equal(html.includes('id="api-key"'), false);
    assert.match(html, /id="clear-dismissed"/);
    assert.match(html, /never dismisses the listing/);

    const appJs = await (await fetch(`${base}/app.js`)).text();
    assert.match(appJs, /class="notes-actions"/);
    assert.match(appJs, /data-save-notes/);
    assert.match(appJs, /JSON\.stringify\(\{ notes:/);
    assert.match(appJs, /JSON\.stringify\(\{ status \}\)/);
    assert.match(appJs, /JSON\.stringify\(\{ called:/);
    assert.match(appJs, /data-clear/);
    assert.match(appJs, /api\/deals\/dismissed/);
    assert.equal(appJs.includes("filterForDeal"), false);
    assert.equal(appJs.includes("body.status = button.dataset.status"), false);
    assert.match(
      appJs,
      /hasAttribute\("data-save-notes"\)\) \{\s*const notes[\s\S]*?JSON\.stringify\(\{ notes:/
    );
    assert.match(appJs, /hasAttribute\("data-clear"\)/);
    assert.match(appJs, /hasAttribute\("data-called"\)[\s\S]*?JSON\.stringify\(\{ called:/);
    assert.match(appJs, /hasAttribute\("data-status"\)[\s\S]*?JSON\.stringify\(\{ status \}\)/);

    const css = await (await fetch(`${base}/styles.css`)).text();
    assert.match(css, /\.notes-actions/);
    assert.match(css, /\.clear-dismissed/);
  });

  it("ingests isolated listings for every board action", async () => {
    ids.notes = (await ingest("notes-stay")).id;
    ids.keep = (await ingest("keep-later")).id;
    ids.called = (await ingest("mark-called")).id;
    ids.dismiss = (await ingest("park-dismiss")).id;
    ids.bulkA = (await ingest("bulk-clear-a")).id;
    ids.bulkB = (await ingest("bulk-clear-b")).id;
    ids.savedStay = (await ingest("saved-must-stay")).id;
  });

  it("Save notes does not change status, even if dismissed is sent with the note", async () => {
    const noted = await req(`/api/deals/${ids.notes}`, {
      method: "PATCH",
      body: JSON.stringify({ notes: "Spoke with broker" }),
    });
    assert.equal(noted.body.deal.status, "new");
    assert.equal(noted.body.deal.called, false);
    assert.equal(noted.body.deal.notes, "Spoke with broker");

    const stray = await req(`/api/deals/${ids.notes}`, {
      method: "PATCH",
      body: JSON.stringify({ notes: "Spoke with broker", status: "dismissed" }),
    });
    assert.equal(stray.body.deal.status, "new");
    assert.equal(stray.body.deal.notes, "Spoke with broker");

    const listed = await req("/api/deals?status=new");
    assert.ok(listed.body.deals.some((deal) => deal.id === ids.notes));
    const dismissed = await req("/api/deals?status=dismissed");
    assert.equal(dismissed.body.deals.some((deal) => deal.id === ids.notes), false);
  });

  it("Keep files a listing without dropping notes", async () => {
    await req(`/api/deals/${ids.keep}`, {
      method: "PATCH",
      body: JSON.stringify({ notes: "Follow up Friday" }),
    });
    const kept = await req(`/api/deals/${ids.keep}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "saved" }),
    });
    assert.equal(kept.body.deal.status, "saved");
    assert.equal(kept.body.deal.notes, "Follow up Friday");
    const saved = await req("/api/deals?status=saved");
    assert.ok(saved.body.deals.some((deal) => deal.id === ids.keep));
    const stillNew = await req("/api/deals?status=new");
    assert.equal(stillNew.body.deals.some((deal) => deal.id === ids.keep), false);
  });

  it("Mark called and Unmark called keep status and notes", async () => {
    await req(`/api/deals/${ids.called}`, {
      method: "PATCH",
      body: JSON.stringify({ notes: "Left voicemail" }),
    });
    const called = await req(`/api/deals/${ids.called}`, {
      method: "PATCH",
      body: JSON.stringify({ called: true }),
    });
    assert.equal(called.body.deal.called, true);
    assert.equal(called.body.deal.status, "new");
    assert.equal(called.body.deal.notes, "Left voicemail");
    const listed = await req("/api/deals?status=called");
    assert.ok(listed.body.deals.some((deal) => deal.id === ids.called));
    const unmarked = await req(`/api/deals/${ids.called}`, {
      method: "PATCH",
      body: JSON.stringify({ called: false }),
    });
    assert.equal(unmarked.body.deal.called, false);
    assert.equal(unmarked.body.deal.status, "new");
    assert.equal(unmarked.body.deal.notes, "Left voicemail");
  });

  it("Dismiss parks a listing until Restore or Clear, and notes do not un-dismiss it", async () => {
    const parked = await req(`/api/deals/${ids.dismiss}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "dismissed" }),
    });
    assert.equal(parked.body.deal.status, "dismissed");
    const onDismissed = await req("/api/deals?status=dismissed");
    assert.ok(onDismissed.body.deals.some((deal) => deal.id === ids.dismiss));
    const offNew = await req("/api/deals?status=new");
    assert.equal(offNew.body.deals.some((deal) => deal.id === ids.dismiss), false);

    const noted = await req(`/api/deals/${ids.dismiss}`, {
      method: "PATCH",
      body: JSON.stringify({ notes: "Not a fit this week" }),
    });
    assert.equal(noted.body.deal.status, "dismissed");
    assert.equal(noted.body.deal.notes, "Not a fit this week");

    const scanHit = ingestSearchListings(db, [
      {
        url: getDeal(db, ids.dismiss).url,
        title: "Park Dismiss Seller Financing Real Estate",
        snippet: "Seller financing available. Real estate included.",
      },
    ]);
    assert.equal(scanHit.dealsAdded, 0);
    assert.equal(getDeal(db, ids.dismiss).status, "dismissed");

    const restored = await req(`/api/deals/${ids.dismiss}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "new" }),
    });
    assert.equal(restored.body.deal.status, "new");
    assert.equal(restored.body.deal.notes, "Not a fit this week");
    await req(`/api/deals/${ids.dismiss}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "dismissed" }),
    });

    const cleared = await req(`/api/deals/${ids.dismiss}`, { method: "DELETE" });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.deleted, true);
    const gone = await req(`/api/deals/${ids.dismiss}`);
    assert.equal(gone.status, 404);

    const again = await req("/api/deals", {
      method: "POST",
      headers: { "X-API-Key": "test-key" },
      body: JSON.stringify({
        url: cleared.body.deal.url,
        title: "Park Dismiss Seller Financing Real Estate",
        description: "Seller financing available. Real estate included.",
      }),
    });
    assert.equal(again.body.inserted, false);
  });

  it("search finds notes without changing status", async () => {
    const found = await req("/api/deals?status=all&q=Follow%20up%20Friday");
    assert.ok(found.body.deals.some((deal) => deal.id === ids.keep));
    assert.equal(getDeal(db, ids.keep).status, "saved");
  });

  it("Clear dismissed removes only dismissed listings", async () => {
    await req(`/api/deals/${ids.savedStay}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "saved" }),
    });
    await req(`/api/deals/${ids.bulkA}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "dismissed" }),
    });
    await req(`/api/deals/${ids.bulkB}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "dismissed" }),
    });

    const beforeNew = listDeals(db, { status: "new" }).length;
    const beforeSaved = listDeals(db, { status: "saved" }).length;
    const result = await req("/api/deals/dismissed", { method: "DELETE" });
    assert.equal(result.status, 200);
    assert.ok(result.body.deleted >= 2);
    assert.equal(listDeals(db, { status: "dismissed" }).length, 0);
    assert.equal(getDeal(db, ids.savedStay)?.status, "saved");
    assert.ok(getDeal(db, ids.notes));
    assert.ok(getDeal(db, ids.keep));
    assert.equal(listDeals(db, { status: "saved" }).length, beforeSaved);
    assert.equal(listDeals(db, { status: "new" }).length, beforeNew);
  });

  it("stats still count new, saved, and called after the board actions", async () => {
    const stats = await req("/api/stats");
    assert.ok(stats.body.stats.new >= 1);
    assert.ok(stats.body.stats.saved >= 1);
    assert.equal(stats.body.stats.called, 0);
  });

  it("board source files stay cache-busted", async () => {
    for (const path of ["/", "/app.js", "/styles.css", "/sw.js"]) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("cache-control") || "", /no-cache/);
    }
    const sw = await (await fetch(`${base}/sw.js`)).text();
    assert.match(sw, /deal-scout-v1[6-9]|deal-scout-v[2-9][0-9]/);
    assert.match(readFileSync(join(root, "../public/index.html"), "utf8"), /id="clear-dismissed"/);
  });
});
