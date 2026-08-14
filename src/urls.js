export const LISTING_HOSTS = [
  "bizbuysell.com",
  "bizquest.com",
  "businessesforsale.com",
  "businessbroker.net",
  "loopnet.com",
  "crexi.com",
  "businessesforsale.co.uk",
  "tranworld.com",
];

const SKIP_PATH_PARTS = [
  "/learning-center",
  "/news/",
  "/blog/",
  "/advice/",
  "/search",
  "/businesses-for-sale/",
  "/owner-financed-businesses-for-sale",
];

export function decodeEntities(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

export function decodeDuckDuckGoUrl(href = "") {
  const raw = href.startsWith("//") ? `https:${href}` : href;
  try {
    const parsed = new URL(raw, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return uddg;
    return parsed.href;
  } catch {
    return href;
  }
}

export function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function sourceFromUrl(url) {
  const host = hostnameOf(url);
  if (host.includes("bizbuysell")) return "BizBuySell";
  if (host.includes("bizquest")) return "BizQuest";
  if (host.includes("businessesforsale")) return "BusinessesForSale";
  if (host.includes("businessbroker")) return "BusinessBroker.net";
  if (host.includes("loopnet")) return "LoopNet";
  if (host.includes("crexi")) return "Crexi";
  return host || "Web";
}

export function isKnownListingHost(url) {
  const host = hostnameOf(url);
  return LISTING_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function canonicalizeUrl(url) {
  const decoded = decodeDuckDuckGoUrl(url);
  const parsed = new URL(decoded);
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.protocol = "https:";
  const drop = new Set([
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid",
    "rut",
  ]);
  for (const key of [...parsed.searchParams.keys()]) {
    if (drop.has(key) || key.startsWith("utm_")) parsed.searchParams.delete(key);
  }
  let path = parsed.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  parsed.pathname = path;
  parsed.searchParams.sort();
  const search = parsed.searchParams.toString();
  return `${parsed.origin}${parsed.pathname}${search ? `?${search}` : ""}`;
}

export function isListingUrl(url) {
  let parsed;
  try {
    parsed = new URL(canonicalizeUrl(url));
  } catch {
    return false;
  }
  if (!isKnownListingHost(parsed.href)) return false;
  const path = parsed.pathname.toLowerCase();
  if (SKIP_PATH_PARTS.some((part) => path.includes(part))) return false;
  if (path === "/" || path === "") return false;

  if (path.includes("/business-opportunity/") || path.includes("/business-for-sale/")) {
    return /\/\d{5,}(?:\/|$)/.test(path);
  }
  if (/\/\d{5,}(?:\/|$)/.test(path)) return true;
  if (path.includes("/detail/")) return true;
  return false;
}

export function listingFingerprint(title, location, priceAmount) {
  const norm = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return [norm(title), norm(location), priceAmount ?? ""].join("|");
}
