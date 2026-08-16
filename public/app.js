const dealsEl = document.querySelector("#deals");
const emptyEl = document.querySelector("#empty");
const statsEl = document.querySelector("#stats");
const scanBtn = document.querySelector("#scan-btn");
const scanStatus = document.querySelector("#scan-status");
const searchEl = document.querySelector("#search");
const exampleEl = document.querySelector("#ingest-example");
const apiKeyEl = document.querySelector("#api-key");

apiKeyEl.value = localStorage.getItem("dealScoutApiKey") || "";
apiKeyEl.addEventListener("input", () => {
  localStorage.setItem("dealScoutApiKey", apiKeyEl.value.trim());
});

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
  const key = apiKeyEl.value.trim();
  if (key) headers["X-API-Key"] = key;
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
  if (added === 0) {
    return `Last scan ${when}: no new listings · ${skipped} already in your list`;
  }
  return `Last scan ${when}: ${added} new · ${skipped} already in your list`;
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
    return "No new listings this scan. Public search is still returning the same matches you already have under New.";
  }
  if (statusFilter === "new") {
    return "No unreviewed deals. Run a scan, or everything is saved, called, or dismissed.";
  }
  return "No deals in this view.";
}

function setFilter(next) {
  statusFilter = next;
  document.querySelectorAll(".chip").forEach((el) => el.classList.toggle("active", el.dataset.status === next));
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
      <div class="row">
        <a href="${deal.url}" target="_blank" rel="noreferrer">Open listing</a>
        <button type="button" data-id="${deal.id}" data-save-notes="1">Save notes</button>
        <button type="button" data-id="${deal.id}" data-called="${deal.called ? "0" : "1"}">${deal.called ? "Unmark called" : "Mark called"}</button>
        <button type="button" data-id="${deal.id}" data-status="saved">Save</button>
        <button type="button" data-id="${deal.id}" data-status="dismissed">Dismiss</button>
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
  params.set("qualified", "1");
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
  scanStatus.textContent = "Scanning public listing search results…";
  try {
    const result = await api("api/scan", { method: "POST", body: "{}" });
    const s = result.summary || {};
    if (s.error) {
      scanNotice = `Scan failed: ${s.error}`;
    } else if ((s.dealsAdded || 0) === 0) {
      scanNotice = `No new listings. ${s.dealsSkipped || 0} already in your list — not added again.`;
    } else {
      scanNotice = `Added ${s.dealsAdded} new. ${s.dealsSkipped || 0} already in your list.`;
    }
    setFilter("fresh");
    await refresh();
  } catch (error) {
    const message = error.message || "Scan failed";
    scanNotice = null;
    scanStatus.textContent =
      message.includes("API key")
        ? "Paste the API key above, then tap Scan now."
        : message;
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
  if (!button) return;
  const id = button.dataset.id;
  const body = {};
  if (button.dataset.status) body.status = button.dataset.status;
  if (button.dataset.called !== undefined) body.called = button.dataset.called === "1";
  if (button.dataset.saveNotes) {
    const notes = dealsEl.querySelector(`[data-notes-id="${id}"]`);
    body.notes = notes ? notes.value : "";
  }
  await api(`api/deals/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  await refresh();
});

refresh().catch((error) => {
  scanStatus.textContent = error.message;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
