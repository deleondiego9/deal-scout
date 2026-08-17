import * as cheerio from "cheerio";
import {
  canonicalizeUrl,
  decodeBingUrl,
  decodeDuckDuckGoUrl,
  decodeEntities,
  isListingUrl,
  listingKey,
} from "./urls.js";

export const DEFAULT_QUERIES = [
  'site:bizbuysell.com "seller financing" "real estate included"',
  'site:bizbuysell.com "owner financing" "real estate included"',
  'site:bizbuysell.com "seller financing" "includes real estate"',
  'site:bizbuysell.com "seller financing" "business and real estate"',
  'site:bizbuysell.com/business-opportunity "real estate included"',
  'site:bizbuysell.com/business-opportunity "seller financing"',
  'site:bizbuysell.com/business-opportunity "owner financing"',
  'site:bizquest.com "seller financing" "real estate included"',
  'site:loopnet.com/Listing "seller financing"',
  'site:loopnet.com/Listing "owner financing"',
  'site:loopnet.com "seller financing"',
  'site:loopnet.com "owner financing"',
  '"business for sale" "seller financing" "real estate included"',
];

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

function asListing(url, title, snippet) {
  try {
    const canonical = canonicalizeUrl(url);
    if (!isListingUrl(canonical)) return null;
    const cleaned = decodeEntities(title || "").replace(/\s+/g, " ").trim();
    return {
      url: canonical,
      title: nicerTitle(cleaned, canonical) || cleaned || canonical,
      snippet: decodeEntities(snippet || "").replace(/\s+/g, " ").trim(),
    };
  } catch {
    return null;
  }
}

export function parseDuckDuckGoHtml(html) {
  if (/anomaly|captcha/i.test(html) && !html.includes("result__a") && !html.includes("result-link")) {
    return [];
  }
  const $ = cheerio.load(html);
  const results = [];
  $(".result__body").each((_, el) => {
    const node = $(el);
    const href = node.find("a.result__a").attr("href") || "";
    const title = decodeEntities(node.find("a.result__a").text().trim());
    const snippet = decodeEntities(node.find("a.result__snippet").text().replace(/\s+/g, " ").trim());
    if (!href || !title) return;
    let url;
    try {
      url = canonicalizeUrl(decodeDuckDuckGoUrl(href));
    } catch {
      return;
    }
    const listing = asListing(url, title, snippet);
    if (listing) results.push(listing);
  });
  if (results.length) return results;
  return parseDuckDuckGoLite(html);
}

export function parseDuckDuckGoLite(html) {
  if (!html || (/anomaly|captcha/i.test(html) && !/uddg=|bizbuysell|bizquest/i.test(html))) return [];
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();
  $("a[href]").each((_, el) => {
    const node = $(el);
    const href = node.attr("href") || "";
    if (!/uddg=|bizbuysell|bizquest|businessesforsale|loopnet|crexi/i.test(href)) return;
    let url;
    try {
      url = canonicalizeUrl(decodeDuckDuckGoUrl(href));
    } catch {
      return;
    }
    const title = decodeEntities(node.text().trim());
    const snippet = decodeEntities(
      node.closest("tr").next("tr").text().replace(/\s+/g, " ").trim()
    );
    const listing = asListing(url, title, snippet);
    if (!listing || seen.has(listing.url)) return;
    seen.add(listing.url);
    results.push(listing);
  });
  return results;
}

export function parseBingHtml(html) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  $("li.b_algo").each((_, el) => {
    const node = $(el);
    const href = node.find("h2 a").attr("href") || node.find("a[href]").first().attr("href") || "";
    const title = node.find("h2").text().replace(/\s+/g, " ").trim();
    const snippet = node.find(".b_caption p, p").first().text().replace(/\s+/g, " ").trim();
    const listing = asListing(decodeBingUrl(href), title, snippet);
    if (!listing || seen.has(listing.url)) return;
    seen.add(listing.url);
    results.push(listing);
  });

  const encoded = decodeEntities(html).matchAll(/[?&]u=a1([A-Za-z0-9_-]+)/g);
  for (const match of encoded) {
    const listing = asListing(decodeBingUrl(`https://www.bing.com/ck/a?u=a1${match[1]}`), "", "");
    if (!listing || seen.has(listing.url)) continue;
    seen.add(listing.url);
    results.push(listing);
  }
  return results;
}

export function parseBingRss(xml) {
  if (!xml || !xml.includes("<item>")) return [];
  const $ = cheerio.load(xml, { xmlMode: true });
  const results = [];
  const seen = new Set();
  $("item").each((_, el) => {
    const node = $(el);
    const listing = asListing(
      node.find("link").first().text().trim(),
      node.find("title").first().text(),
      node.find("description").first().text()
    );
    if (!listing || seen.has(listing.url)) return;
    seen.add(listing.url);
    results.push(listing);
  });
  return results;
}

function listingIdentity(result) {
  return listingKey(result.url) || result.url;
}

function mergeListings(target, incoming, query) {
  for (const result of incoming) {
    if (!isListingUrl(result.url)) continue;
    const id = listingIdentity(result);
    const prev = target.get(id);
    if (!prev) {
      target.set(id, { ...result, query });
      continue;
    }
    const snippet = mergeSnippet(prev.snippet, result.snippet);
    const title =
      nicerTitle(result.title, result.url) || nicerTitle(prev.title, prev.url) || prev.title;
    target.set(id, {
      ...prev,
      ...result,
      query: prev.query,
      title,
      snippet,
    });
  }
}

function mergeSnippet(left = "", right = "") {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  if (!a) return b;
  if (!b || a.includes(b)) return a;
  if (b.includes(a)) return b;
  return `${a} ${b}`;
}

function nicerTitle(title, url) {
  const text = String(title || "").replace(/\s+/g, " ").trim();
  if (text && !/^https?:\/\//i.test(text) && !text.includes("›")) return text;
  return titleFromListingUrl(url);
}

export function titleFromListingUrl(url = "") {
  try {
    const path = decodeURIComponent(new URL(canonicalizeUrl(url)).pathname);
    const slug = path
      .split("/")
      .filter(Boolean)
      .find(
        (part) =>
          !/^\d+$/.test(part) &&
          !["business-opportunity", "business-for-sale", "listing", "properties", "biz"].includes(
            part.toLowerCase()
          )
      );
    if (!slug) return "";
    return slug
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  } catch {
    return "";
  }
}

async function fetchDirect(url, { fetchImpl = fetch, headers = DEFAULT_HEADERS } = {}) {
  const response = await fetchImpl(url, { headers, redirect: "follow" });
  if (!response.ok) return { status: response.status, text: "" };
  return { status: response.status, text: await response.text() };
}

function looksBlockedOrEmpty(text, status) {
  if (status === 202 || status === 403 || status === 429) return true;
  if (!text) return true;
  if (/anomaly|captcha/i.test(text) && !text.includes("result__a") && !text.includes("result-link") && !text.includes("<item>")) {
    return true;
  }
  return false;
}

function hasListingSignal(text) {
  return /bizbuysell\.com\/(?:business-opportunity|business-for-sale)|loopnet\.com\/Listing|bizquest\.com\/business-for-sale|crexi\.com\/properties/i.test(
    text
  );
}

function isUsableSearchPayload(text) {
  if (!text) return false;
  return (
    hasListingSignal(text) ||
    text.includes("result__a") ||
    text.includes("result-link") ||
    parseGenericListingText(text).length > 0
  );
}

function shouldUseDirect(href, text, status) {
  if (looksBlockedOrEmpty(text, status)) return false;
  if (hasListingSignal(text) || text.includes("result__a") || text.includes("result-link")) return true;
  // Bing often returns a 200 results page with no marketplace listings. Do not
  // spend reader quota on that; DuckDuckGo-via-reader is the LoopNet path.
  if (/bing\.com/i.test(href) && (text.includes("b_algo") || text.includes("<item>"))) return true;
  return false;
}

function proxyFetchOptions(headers) {
  const options = { headers, redirect: "follow" };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    options.signal = AbortSignal.timeout(20000);
  }
  return options;
}

async function fetchViaJina(url, { fetchImpl = fetch, headers = DEFAULT_HEADERS } = {}) {
  const target = `https://r.jina.ai/${url}`;
  const response = await fetchImpl(target, {
    ...proxyFetchOptions({
      ...headers,
      Accept: "text/html,text/plain,*/*",
      "X-Return-Format": "html",
    }),
  });
  if (!response.ok) return "";
  return response.text();
}

async function fetchViaAllOrigins(url, { fetchImpl = fetch, headers = DEFAULT_HEADERS } = {}) {
  const target = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  const response = await fetchImpl(target, proxyFetchOptions(headers));
  if (!response.ok) return "";
  return response.text();
}

export function parseGenericListingText(text) {
  if (!text) return [];
  const results = [];
  const seen = new Set();
  const re =
    /https?:\/\/(?:www\.)?(?:bizbuysell|loopnet|bizquest|crexi)\.com\/[^\s"'<>\]]+/gi;
  for (const match of text.matchAll(re)) {
    const raw = match[0].replace(/[),.;]+$/, "");
    const listing = asListing(raw, "", "");
    if (!listing || seen.has(listing.url)) continue;
    seen.add(listing.url);
    results.push(listing);
  }
  return results;
}

function parseSearchPayload(text) {
  const parsed = [
    ...parseDuckDuckGoHtml(text),
    ...parseBingHtml(text),
    ...parseBingRss(text),
    ...parseGenericListingText(text),
  ];
  const seen = new Set();
  const out = [];
  for (const item of parsed) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

async function fetchSearchHtml(url, options = {}) {
  const href = String(url);
  const direct = await fetchDirect(href, options);
  if (shouldUseDirect(href, direct.text, direct.status)) {
    return direct.text;
  }
  if (options.disableProxy) return direct.text || "";
  try {
    const jina = await fetchViaJina(href, options);
    if (isUsableSearchPayload(jina)) return jina;
  } catch {
    // try the next proxy
  }
  try {
    const origin = await fetchViaAllOrigins(href, options);
    if (isUsableSearchPayload(origin)) return origin;
  } catch {
    // fall through
  }
  return direct.text || "";
}

export async function searchDuckDuckGo(query, options = {}) {
  const endpoints = [
    "https://html.duckduckgo.com/html/",
    "https://duckduckgo.com/html/",
    "https://lite.duckduckgo.com/lite/",
  ];
  const offsets = [0];
  for (const endpoint of endpoints) {
    const found = [];
    const seen = new Set();
    for (const offset of offsets) {
      try {
        const target = new URL(endpoint);
        target.searchParams.set("q", query);
        if (offset) target.searchParams.set("s", String(offset));
        const html = await fetchSearchHtml(target, options);
        const parsed = parseDuckDuckGoHtml(html);
        const listings = parsed.length ? parsed : parseSearchPayload(html);
        if (!listings.length) break;
        let added = 0;
        for (const result of listings) {
          if (seen.has(result.url)) continue;
          seen.add(result.url);
          found.push(result);
          added += 1;
        }
        if (!added) break;
      } catch {
        break;
      }
    }
    if (found.length) return found;
  }
  return [];
}

export async function searchBing(query, options = {}) {
  const target = new URL("https://www.bing.com/search");
  target.searchParams.set("q", query);
  try {
    const html = await fetchSearchHtml(target, options);
    const parsed = parseBingHtml(html);
    return parsed.length ? parsed : parseSearchPayload(html);
  } catch {
    return [];
  }
}

export async function searchBingRss(query, options = {}) {
  const target = new URL("https://www.bing.com/search");
  target.searchParams.set("q", query);
  target.searchParams.set("format", "rss");
  try {
    const xml = await fetchSearchHtml(target, options);
    const parsed = parseBingRss(xml);
    if (parsed.length) return parsed;
    return parseGenericListingText(xml);
  } catch {
    return [];
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function collectListingResults(queries = DEFAULT_QUERIES, options = {}) {
  const listings = new Map();
  const delayMs = options.searchDelayMs ?? options.delayMs ?? 0;

  for (const query of queries) {
    mergeListings(listings, await searchDuckDuckGo(query, options), query);
    mergeListings(listings, await searchBing(query, options), query);
    mergeListings(listings, await searchBingRss(query, options), query);
    if (delayMs) await sleep(delayMs);
  }
  return [...listings.values()];
}
