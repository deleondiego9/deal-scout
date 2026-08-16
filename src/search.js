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
  'site:bizbuysell.com/business-opportunity owner financing real estate included',
  'site:bizbuysell.com "owner financing" "real estate included"',
  'site:bizbuysell.com "seller financing" "includes real estate"',
  'site:bizbuysell.com "seller financing" "business and real estate"',
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
    return {
      url: canonical,
      title: decodeEntities(title || "").replace(/\s+/g, " ").trim() || canonical,
      snippet: decodeEntities(snippet || "").replace(/\s+/g, " ").trim(),
    };
  } catch {
    return null;
  }
}

export function parseDuckDuckGoHtml(html) {
  if (/anomaly|captcha/i.test(html) && !html.includes("result__a")) return [];
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
    const longer = (result.snippet || "").length > (prev.snippet || "").length;
    if (longer) {
      target.set(id, {
        ...prev,
        ...result,
        query: prev.query,
        title: result.title || prev.title,
        snippet: result.snippet,
      });
    }
  }
}

async function fetchSearchHtml(url, { fetchImpl = fetch, headers = DEFAULT_HEADERS } = {}) {
  const response = await fetchImpl(url, { headers, redirect: "follow" });
  if (!response.ok) return "";
  return response.text();
}

export async function searchDuckDuckGo(query, options = {}) {
  const endpoints = ["https://html.duckduckgo.com/html/", "https://duckduckgo.com/html/"];
  for (const endpoint of endpoints) {
    try {
      const target = new URL(endpoint);
      target.searchParams.set("q", query);
      const html = await fetchSearchHtml(target, options);
      const parsed = parseDuckDuckGoHtml(html);
      if (parsed.length) return parsed;
    } catch {
      // try the next DuckDuckGo host
    }
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

export async function collectListingResults(queries = DEFAULT_QUERIES, options = {}) {
  const listings = new Map();

  for (const query of queries) {
    mergeListings(listings, await searchDuckDuckGo(query, options), query);
    mergeListings(listings, await searchBing(query, options), query);
    mergeListings(listings, await searchBingRss(query, options), query);
  }
  return [...listings.values()];
}
