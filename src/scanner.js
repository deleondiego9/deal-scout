import { extractFromHtml, extractFromSearchResult } from "./extract.js";
import { collectListingResults, DEFAULT_QUERIES } from "./search.js";
import { canonicalizeUrl, listingFingerprint, listingKey } from "./urls.js";
import {
  finishScan,
  findDealByFingerprint,
  findDealByListingKey,
  findDealByUrl,
  recordSkip,
  startScan,
  upsertDeal,
} from "./db.js";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

function existingDeal(db, canonicalUrl, key, fingerprint) {
  return (
    findDealByUrl(db, canonicalUrl) ||
    findDealByListingKey(db, key) ||
    findDealByFingerprint(db, fingerprint)
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function enrichFromListing(result, { fetchImpl, headers }) {
  try {
    const response = await fetchImpl(result.url, { headers, redirect: "follow" });
    if (!response.ok) return extractFromSearchResult(result);
    const html = await response.text();
    if (/access denied|captcha|just a moment/i.test(html) && html.length < 2000) {
      return extractFromSearchResult(result);
    }
    const extracted = extractFromHtml(html, result.url);
    if (!extracted.description && result.snippet) {
      extracted.description = result.snippet;
      extracted.excerpt = result.snippet.slice(0, 500);
    }
    if (extracted.title === "Untitled listing" && result.title) extracted.title = result.title;
    return extracted;
  } catch {
    return extractFromSearchResult(result);
  }
}

export function ingestSearchListings(db, listings, options = {}) {
  const {
    requireBoth = true,
    origin = "scan",
    maxResults = 80,
  } = options;

  const summary = {
    urlsFound: listings.length,
    dealsAdded: 0,
    dealsSkipped: 0,
    dealsUnqualified: 0,
    added: [],
  };

  const sliced = listings.slice(0, maxResults);
  for (const result of sliced) {
    if (!result?.url) {
      summary.dealsUnqualified += 1;
      continue;
    }
    let canonicalUrl;
    try {
      canonicalUrl = canonicalizeUrl(result.url);
    } catch {
      summary.dealsUnqualified += 1;
      continue;
    }
    const key = listingKey(canonicalUrl);
    if (existingDeal(db, canonicalUrl, key)) {
      recordSkip(db, { canonicalUrl, listingKey: key });
      summary.dealsSkipped += 1;
      continue;
    }

    const extracted = extractFromSearchResult({ ...result, url: canonicalUrl });
    const fingerprint = listingFingerprint(
      extracted.title,
      extracted.location,
      extracted.priceAmount
    );
    if (existingDeal(db, canonicalUrl, key, fingerprint)) {
      recordSkip(db, { canonicalUrl, fingerprint, listingKey: key });
      summary.dealsSkipped += 1;
      continue;
    }

    if (requireBoth && !extracted.qualified) {
      summary.dealsUnqualified += 1;
      continue;
    }

    const saved = upsertDeal(db, {
      ...extracted,
      canonicalUrl,
      origin,
    });
    if (saved.inserted) {
      summary.dealsAdded += 1;
      summary.added.push(saved.deal);
    } else {
      summary.dealsSkipped += 1;
    }
  }

  return summary;
}

export async function runScan(db, options = {}) {
  const {
    queries = DEFAULT_QUERIES,
    fetchImpl = fetch,
    delayMs = 800,
    maxResults = 80,
    requireBoth = true,
    enrich = false,
    origin = "scan",
  } = options;

  const scanId = startScan(db);
  const summary = {
    queriesRun: queries.length,
    urlsFound: 0,
    dealsAdded: 0,
    dealsSkipped: 0,
    dealsUnqualified: 0,
    error: null,
    added: [],
  };

  try {
    const listings = await collectListingResults(queries, {
      fetchImpl,
      searchDelayMs: Math.min(delayMs || 0, 800),
    });
    summary.urlsFound = listings.length;

    if (enrich) {
      const sliced = listings.slice(0, maxResults);
      for (const result of sliced) {
        const canonicalUrl = canonicalizeUrl(result.url);
        const key = listingKey(canonicalUrl);
        if (existingDeal(db, canonicalUrl, key)) {
          recordSkip(db, { canonicalUrl, listingKey: key });
          summary.dealsSkipped += 1;
          continue;
        }
        const extracted = await enrichFromListing(
          { ...result, url: canonicalUrl },
          { fetchImpl, headers: DEFAULT_HEADERS }
        );
        if (delayMs) await sleep(delayMs);
        const fingerprint = listingFingerprint(
          extracted.title,
          extracted.location,
          extracted.priceAmount
        );
        if (existingDeal(db, canonicalUrl, key, fingerprint)) {
          recordSkip(db, { canonicalUrl, fingerprint, listingKey: key });
          summary.dealsSkipped += 1;
          continue;
        }
        if (requireBoth && !extracted.qualified) {
          summary.dealsUnqualified += 1;
          continue;
        }
        const saved = upsertDeal(db, { ...extracted, canonicalUrl, origin });
        if (saved.inserted) {
          summary.dealsAdded += 1;
          summary.added.push(saved.deal);
        } else {
          summary.dealsSkipped += 1;
        }
      }
    } else {
      const ingested = ingestSearchListings(db, listings, {
        requireBoth,
        origin,
        maxResults,
      });
      summary.dealsAdded = ingested.dealsAdded;
      summary.dealsSkipped = ingested.dealsSkipped;
      summary.dealsUnqualified = ingested.dealsUnqualified;
      summary.added = ingested.added;
    }
  } catch (error) {
    summary.error = error.message;
  }

  finishScan(db, scanId, summary);
  return summary;
}

export function ingestDeal(db, payload) {
  if (!payload?.url) throw new Error("url is required");
  const canonicalUrl = canonicalizeUrl(payload.url);
  const extracted = payload.html
    ? extractFromHtml(payload.html, canonicalUrl)
    : extractFromSearchResult({
        url: canonicalUrl,
        title: payload.title,
        snippet: payload.description || payload.excerpt || "",
      });

  const merged = {
    ...extracted,
    canonicalUrl,
    title: payload.title || extracted.title,
    priceText: payload.priceText || extracted.priceText,
    priceAmount: payload.priceAmount ?? extracted.priceAmount,
    location: payload.location || extracted.location,
    description: payload.description || extracted.description,
    excerpt: payload.excerpt || extracted.excerpt,
    origin: payload.origin || "agent",
  };

  if (payload.sellerFinancing !== undefined) merged.sellerFinancing = Boolean(payload.sellerFinancing);
  if (payload.realEstateIncluded !== undefined) {
    merged.realEstateIncluded = Boolean(payload.realEstateIncluded);
  }
  merged.qualified = Boolean(merged.sellerFinancing && merged.realEstateIncluded);
  if (payload.score !== undefined) merged.score = payload.score;

  return upsertDeal(db, merged);
}

export function importScan(db, listings, options = {}) {
  const scanId = startScan(db);
  const ingested = ingestSearchListings(db, listings, options);
  const summary = {
    queriesRun: options.queriesRun ?? 0,
    urlsFound: ingested.urlsFound,
    dealsAdded: ingested.dealsAdded,
    dealsSkipped: ingested.dealsSkipped,
    dealsUnqualified: ingested.dealsUnqualified,
    added: ingested.added,
    error: null,
  };
  finishScan(db, scanId, summary);
  return summary;
}
