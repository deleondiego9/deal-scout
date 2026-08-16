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
    if (!/uddg=|bizbuysell|bizquest|businessesforsale/i.test(href)) return;
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
    const slug = path.split("/").filter(Boolean).find((part) => !/^\d+$/.test(part) && part !== "business-opportunity" && part !== "business-for-sale");
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

async function fetchSearchHtml(url, { fetchImpl = fetch, headers = DEFAULT_HEADERS } = {}) {
  const response = await fetchImpl(url, { headers, redirect: "follow" });
  if (!response.ok) return "";
  return response.text();
}

export async function searchDuckDuckGo(query, options = {}) {
  const endpoints = [
    "https://html.duckduckgo.com/html/",
    "https://duckduckgo.com/html/",
    "https://lite.duckduckgo.com/lite/",
  ];
  const offsets = [0, 20, 50];
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
        if (!parsed.length) break;
        let added = 0;
        for (const result of parsed) {
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
    return parseBingHtml(html);
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
    return parseBingRss(xml);
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
