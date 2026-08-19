import * as cheerio from "cheerio";
import { classify, parseLocation, parsePrice } from "./classify.js";
import { earlierListedAt, listedAtFromInput, parseDateToIso, parseListedAt } from "./listed.js";
import { decodeEntities, sourceFromUrl } from "./urls.js";

function jsonLdBlocks(html) {
  const $ = cheerio.load(html);
  const blocks = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    try {
      const parsed = JSON.parse(raw);
      blocks.push(parsed);
    } catch {
      // ignore broken JSON-LD
    }
  });
  return blocks.flatMap((block) => (Array.isArray(block) ? block : [block]));
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return decodeEntities(value.trim());
  }
  return null;
}

export function extractFromHtml(html, url) {
  const $ = cheerio.load(html || "");
  const ld = jsonLdBlocks(html || "");
  const offer = ld.find((item) => item["@type"] === "Offer" || item.price || item.priceCurrency);
  const product = ld.find((item) =>
    ["Product", "LocalBusiness", "Restaurant", "Store"].includes(item["@type"])
  );

  const title = firstText(
    $('meta[property="og:title"]').attr("content"),
    $("h1").first().text(),
    $("title").text()
  );

  const description = firstText(
    $('meta[property="og:description"]').attr("content"),
    $('meta[name="description"]').attr("content"),
    product?.description,
    $("p").first().text()
  );

  const priceText = firstText(
    offer?.price ? `$${offer.price}` : null,
    $('[itemprop="price"]').first().text(),
    html?.match(/Asking Price[^$]*(\$[\d,]+)/i)?.[1],
    html?.match(/\$\s*[0-9]{1,3}(?:,[0-9]{3})+/)?.[0]
  );

  const location = firstText(
    product?.address?.addressLocality
      ? `${product.address.addressLocality}, ${product.address.addressRegion || ""}`.trim()
      : null,
    $('[itemprop="address"]').first().text(),
    parseLocation(`${title}\n${description}`)
  );

  const visible = `${title || ""}\n${description || ""}\n${$("body").text().slice(0, 4000)}`;
  const flags = withMarketplaceDefaults(url, classify(visible));
  const priceAmount = parsePrice(priceText || visible);
  const listedAt = [
    parseDateToIso(offer?.datePosted),
    parseDateToIso(product?.datePosted),
    parseDateToIso(product?.datePublished),
    parseDateToIso(offer?.availabilityStarts),
    parseListedAt(visible),
    listedAtFromInput({ title, description, html }),
  ].reduce((best, next) => earlierListedAt(best, next), null);

  return {
    url,
    source: sourceFromUrl(url),
    title: title || "Untitled listing",
    priceText,
    priceAmount,
    location: location || parseLocation(visible),
    description: description || null,
    excerpt: (description || visible).replace(/\s+/g, " ").trim().slice(0, 500),
    listedAt,
    ...flags,
  };
}

export function isPropertyMarketplaceListing(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^(www|m)\./, "").toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (host === "loopnet.com" && path.includes("/listing/")) return true;
    if (host === "crexi.com" && path.includes("/properties/")) return true;
    return false;
  } catch {
    return false;
  }
}

export function withMarketplaceDefaults(url, flags) {
  if (!isPropertyMarketplaceListing(url)) return flags;
  if (flags.negativeEvidence?.length) return flags;
  const already = Boolean(flags.realEstateIncluded);
  const realEstateIncluded = true;
  const realEstateEvidence = already
    ? flags.realEstateEvidence
    : [...(flags.realEstateEvidence || []), "commercial property listing"];
  let score = flags.score || 0;
  if (!already) score += 50;
  return {
    ...flags,
    realEstateIncluded,
    realEstateEvidence,
    landDeal: Boolean(flags.landDeal),
    qualified: Boolean(flags.sellerFinancing && realEstateIncluded && !flags.landDeal),
    score: flags.landDeal ? Math.max(0, score - 50) : score,
  };
}

export function listingTextFromSearch({ url, title, snippet } = {}) {
  let slug = "";
  try {
    slug = decodeURIComponent(new URL(url).pathname).replace(/[-/_]+/g, " ");
  } catch {
    slug = "";
  }
  return `${decodeEntities(title || "")}\n${decodeEntities(snippet || "")}\n${slug}`;
}

export function extractFromSearchResult({ url, title, snippet }) {
  const combined = listingTextFromSearch({ url, title, snippet });
  const flags = withMarketplaceDefaults(url, classify(combined));
  return {
    url,
    source: sourceFromUrl(url),
    title: decodeEntities(title || "").replace(/\s+/g, " ").trim() || "Untitled listing",
    priceText: combined.match(/\$\s*[0-9]{1,3}(?:,[0-9]{3})+/)?.[0] || null,
    priceAmount: parsePrice(combined),
    location: parseLocation(combined),
    description: decodeEntities(snippet || "").replace(/\s+/g, " ").trim() || null,
    excerpt: decodeEntities(snippet || "").replace(/\s+/g, " ").trim().slice(0, 500),
    listedAt: listedAtFromInput({ title, snippet }),
    ...flags,
  };
}
