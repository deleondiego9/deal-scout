const dealsEl = document.querySelector("#deals");
const emptyEl = document.querySelector("#empty");
const statsEl = document.querySelector("#stats");
const scanBtn = document.querySelector("#scan-btn");
const scanStatus = document.querySelector("#scan-status");
const searchEl = document.querySelector("#search");
const exampleEl = document.querySelector("#ingest-example");
const clearDismissedBtn = document.querySelector("#clear-dismissed");

let statusFilter = "new";
let query = "";
let scanNotice = null;

exampleEl.textContent = `curl -X POST ${new URL("api/deals", location.href).href} \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: $API_KEY" \\
  -d '{"url":"https://example.com/listing/123","title":"Car wash + real estate","description":"Seller financing available. Real estate included."}'`;

function money(amount, fallback) {
  if (amount == null) return fallback || "Price n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const response = await fetch(path, {
    ...options,
    headers,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function scanSummaryText(last) {
  if (scanNotice) return scanNotice;
  if (last?.startedAt && !last.finishedAt) return "Scan running…";
  if (!last?.finishedAt) return "No scans yet";
  const when = new Date(last.finishedAt).toLocaleString();
  const added = last.dealsAdded ?? 0;
  const skipped = last.dealsSkipped ?? 0;
  const unqualified = last.dealsUnqualified ?? 0;
  const found = last.urlsFound ?? 0;
  if (added === 0) {
    return `Last scan ${when}: no new listings · ${found} listing pages · ${skipped} already in your list · ${unqualified} didn’t mention both`;
  }
  return `Last scan ${when}: ${added} new · ${skipped} already in your list · ${unqualified} didn’t mention both`;
}

function seenBadge(deal, lastScan) {
  if (deal.status !== "new" || !lastScan?.startedAt) return "";
  const scanStart = Date.parse(lastScan.startedAt);
  const firstSeen = Date.parse(deal.firstSeenAt);
  if (!Number.isFinite(scanStart) || !Number.isFinite(firstSeen)) return "";
  if (firstSeen >= scanStart - 1000) {
    return `<span class="flag fresh">Just found</span>`;
  }
  return `<span class="flag already">Already in list</span>`;
}

function renderStats(payload) {
  const s = payload.stats || {};
  const last = payload.lastScan;
  statsEl.innerHTML = [
    ["Qualified", s.qualified ?? 0],
    ["New", s.new ?? 0],
    ["Called", s.called ?? 0],
    ["Saved", s.saved ?? 0],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat"><span>${label}</span><b>${value}</b></div>`
    )
    .join("");
  scanStatus.textContent = scanSummaryText(last);
}

function emptyMessage() {
  if (statusFilter === "fresh") {
    return "No new listings this scan. Search still only found matches you already have, or pages that mention financing or real estate but not both.";
  }
  if (statusFilter === "new") {
    return "No unreviewed deals. Run a scan, or everything is saved, called, or dismissed.";
  }
  if (statusFilter === "dismissed") {
    return "No dismissed listings. Dismiss a deal to park it here until you clear it.";
  }
  return "No deals in this view.";
}

function setFilter(next) {
  statusFilter = next;
  document.querySelectorAll(".chip").forEach((el) => el.classList.toggle("active", el.dataset.status === next));
  clearDismissedBtn.classList.toggle("hidden", next !== "dismissed");
}

function renderDeals(deals, lastScan) {
  dealsEl.innerHTML = "";
  emptyEl.textContent = emptyMessage();
  emptyEl.classList.toggle("hidden", deals.length > 0);
  for (const deal of deals) {
    const card = document.createElement("article");
    card.className = `card${deal.qualified ? " qualified" : ""}${deal.called ? " called" : ""}`;
    card.innerHTML = `
      <div class="source">${deal.source || "Listing"} · ${deal.location || "Location n/a"}</div>
      <h3>${escapeHtml(deal.title)}</h3>
      <div class="price">${money(deal.priceAmount, deal.priceText)}</div>
      <div class="flags">
        ${seenBadge(deal, lastScan)}
        ${deal.sellerFinancing ? `<span class="flag">Seller financing</span>` : ""}
        ${deal.realEstateIncluded ? `<span class="flag">Real estate included</span>` : ""}
        ${deal.called ? `<span class="flag called">Called${deal.calledAt ? " · " + new Date(deal.calledAt).toLocaleDateString() : ""}</span>` : ""}
      </div>
      <p class="excerpt">${escapeHtml(deal.excerpt || deal.description || "")}</p>
      <label class="key-label">Notes
        <textarea class="notes" data-notes-id="${deal.id}" placeholder="Who you spoke with, asking price, follow-up…">${escapeHtml(deal.notes || "")}</textarea>
      </label>
      <div class="notes-actions">
        <button type="button" data-id="${deal.id}" data-save-notes="1">Save notes</button>
      </div>
      <div class="row">
        <a href="${deal.url}" target="_blank" rel="noreferrer">Open listing</a>
        <button type="button" data-id="${deal.id}" data-called="${deal.called ? "0" : "1"}">${deal.called ? "Unmark called" : "Mark called"}</button>
        ${
          deal.status === "dismissed"
            ? `<button type="button" data-id="${deal.id}" data-status="new">Restore</button>
        <button type="button" class="danger" data-id="${deal.id}" data-clear="1">Clear</button>`
            : `<button type="button" data-id="${deal.id}" data-status="saved">Keep</button>
        <button type="button" class="danger" data-id="${deal.id}" data-status="dismissed">Dismiss</button>`
        }
      </div>
    `;
    dealsEl.appendChild(card);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function refresh() {
  const params = new URLSearchParams();
  if (statusFilter) params.set("status", statusFilter);
  if (query) params.set("q", query);
  if (statusFilter && statusFilter !== "dismissed" && statusFilter !== "all") {
    params.set("qualified", "1");
  }
  const [{ deals }, statsPayload] = await Promise.all([
    api(`api/deals?${params}`),
    api("api/stats"),
  ]);
  renderDeals(deals, statsPayload.lastScan);
  renderStats(statsPayload);
}

scanBtn.addEventListener("click", async () => {
  scanBtn.disabled = true;
  scanNotice = null;
  scanStatus.textContent = "Scanning BizBuySell and LoopNet…";
  try {
    const result = await api("api/scan", { method: "POST", body: "{}" });
    const s = result.summary || {};
    const added = s.dealsAdded || 0;
    const skipped = s.dealsSkipped || 0;
    const unqualified = s.dealsUnqualified || 0;
    const found = s.urlsFound || 0;
    if (s.error) {
      scanNotice = `Scan failed: ${s.error}`;
    } else if (added === 0) {
      scanNotice = `No new listings. Search indexed ${found} listing pages · ${skipped} already in your list · ${unqualified} didn’t mention both filters.`;
      setFilter("new");
    } else {
      scanNotice = `Added ${added} new. ${skipped} already in your list. ${unqualified} didn’t mention both filters.`;
      setFilter("fresh");
    }
    await refresh();
  } catch (error) {
    const message = error.message || "Scan failed";
    scanNotice = null;
    scanStatus.textContent = message;
  } finally {
    scanBtn.disabled = false;
  }
});

document.querySelector(".chips").addEventListener("click", (event) => {
  const chip = event.target.closest(".chip");
  if (!chip) return;
  setFilter(chip.dataset.status);
  refresh().catch((error) => {
    scanStatus.textContent = error.message;
  });
});

searchEl.addEventListener("input", () => {
  query = searchEl.value.trim();
  refresh().catch((error) => {
    scanStatus.textContent = error.message;
  });
});

dealsEl.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button || button.disabled) return;
  event.preventDefault();
  event.stopPropagation();
  const id = button.dataset.id;
  button.disabled = true;
  try {
    if (button.hasAttribute("data-save-notes")) {
      const notes = button.closest("article")?.querySelector(`[data-notes-id="${id}"]`);
      await api(`api/deals/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ notes: notes ? notes.value : "" }),
      });
      scanNotice = "Notes saved. Listing stayed in this tab.";
    } else if (button.hasAttribute("data-clear")) {
      await api(`api/deals/${id}`, { method: "DELETE" });
      scanNotice = "Listing cleared.";
    } else if (button.hasAttribute("data-called")) {
      await api(`api/deals/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ called: button.dataset.called === "1" }),
      });
    } else if (button.hasAttribute("data-status")) {
      const status = button.dataset.status;
      await api(`api/deals/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (status === "dismissed") scanNotice = "Parked in Dismissed. Clear it there when you want it gone.";
      if (status === "saved") scanNotice = "Moved to Saved.";
      if (status === "new") scanNotice = "Restored to New.";
    } else {
      return;
    }
    await refresh();
  } catch (error) {
    button.disabled = false;
    scanStatus.textContent = error.message;
  }
});

clearDismissedBtn.addEventListener("click", async () => {
  if (!window.confirm("Remove all dismissed listings from this app? They will not come back on Scan now.")) {
    return;
  }
  try {
    const result = await api("api/deals/dismissed", { method: "DELETE" });
    scanNotice = `Cleared ${result.deleted || 0} dismissed listings.`;
    await refresh();
  } catch (error) {
    scanStatus.textContent = error.message;
  }
});

refresh().catch((error) => {
  scanStatus.textContent = error.message;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
