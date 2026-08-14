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

exampleEl.textContent = `curl -X POST ${location.origin}/api/deals \\
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

function renderStats(payload) {
  const s = payload.stats || {};
  const last = payload.lastScan;
  statsEl.innerHTML = [
    ["Qualified", s.qualified ?? 0],
    ["New", s.new ?? 0],
    ["Saved", s.saved ?? 0],
    ["Total", s.total ?? 0],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat"><span>${label}</span><b>${value}</b></div>`
    )
    .join("");
  if (last?.finishedAt) {
    scanStatus.textContent = `Last scan: ${new Date(last.finishedAt).toLocaleString()} · added ${last.dealsAdded} · skipped ${last.dealsSkipped}`;
  } else if (last?.startedAt && !last.finishedAt) {
    scanStatus.textContent = "Scan running…";
  } else {
    scanStatus.textContent = "No scans yet";
  }
}

function renderDeals(deals) {
  dealsEl.innerHTML = "";
  emptyEl.classList.toggle("hidden", deals.length > 0);
  for (const deal of deals) {
    const card = document.createElement("article");
    card.className = `card${deal.qualified ? " qualified" : ""}`;
    card.innerHTML = `
      <div class="source">${deal.source || "Listing"} · ${deal.location || "Location n/a"}</div>
      <h3>${escapeHtml(deal.title)}</h3>
      <div class="price">${money(deal.priceAmount, deal.priceText)}</div>
      <div class="flags">
        ${deal.sellerFinancing ? `<span class="flag">Seller financing</span>` : ""}
        ${deal.realEstateIncluded ? `<span class="flag">Real estate included</span>` : ""}
      </div>
      <p class="excerpt">${escapeHtml(deal.excerpt || deal.description || "")}</p>
      <div class="row">
        <a href="${deal.url}" target="_blank" rel="noreferrer">Open listing</a>
        <button data-id="${deal.id}" data-status="saved">Save</button>
        <button data-id="${deal.id}" data-status="dismissed">Dismiss</button>
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
    api(`/api/deals?${params}`),
    api("/api/stats"),
  ]);
  renderDeals(deals);
  renderStats(statsPayload);
}

scanBtn.addEventListener("click", async () => {
  scanBtn.disabled = true;
  scanStatus.textContent = "Scanning public listing search results…";
  try {
    const result = await api("/api/scan", { method: "POST", body: "{}" });
    const s = result.summary || {};
    scanStatus.textContent = `Added ${s.dealsAdded || 0}, skipped ${s.dealsSkipped || 0}${s.error ? ` · ${s.error}` : ""}`;
    await refresh();
  } catch (error) {
    scanStatus.textContent = error.message;
  } finally {
    scanBtn.disabled = false;
  }
});

document.querySelector(".chips").addEventListener("click", (event) => {
  const chip = event.target.closest(".chip");
  if (!chip) return;
  statusFilter = chip.dataset.status;
  document.querySelectorAll(".chip").forEach((el) => el.classList.toggle("active", el === chip));
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
  await api(`/api/deals/${button.dataset.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: button.dataset.status }),
  });
  await refresh();
});

refresh().catch((error) => {
  scanStatus.textContent = error.message;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
