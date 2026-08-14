import * as cheerio from "cheerio";
import { canonicalizeUrl, decodeDuckDuckGoUrl, decodeEntities, isListingUrl } from "./urls.js";

export const DEFAULT_QUERIES = [
  'site:bizbuysell.com "seller financing" "real estate included"',
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

export function parseDuckDuckGoHtml(html) {
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
    results.push({ url, title, snippet });
  });
  return results;
}

export async function searchDuckDuckGo(query, { fetchImpl = fetch, headers = DEFAULT_HEADERS } = {}) {
  const target = new URL("https://html.duckduckgo.com/html/");
  target.searchParams.set("q", query);
  const response = await fetchImpl(target, { headers, redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Search failed (${response.status}) for: ${query}`);
  }
  const html = await response.text();
  return parseDuckDuckGoHtml(html);
}

export async function collectListingResults(queries = DEFAULT_QUERIES, options = {}) {
  const seen = new Set();
  const listings = [];
  for (const query of queries) {
    const results = await searchDuckDuckGo(query, options);
    for (const result of results) {
      if (!isListingUrl(result.url)) continue;
      if (seen.has(result.url)) continue;
      seen.add(result.url);
      listings.push({ ...result, query });
    }
  }
  return listings;
}
