const FINANCING_PATTERNS = [
  /seller\s+financ(?:e|ed|ing)/i,
  /owner\s+financ(?:e|ed|ing)/i,
  /owner\s+will\s+carry/i,
  /seller\s+will\s+carry/i,
  /seller\s+carry/i,
  /owner\s+carry/i,
  /carry\s+back/i,
  /carry\s+paper/i,
  /seller\s+note/i,
  /owner\s+note/i,
  /will\s+carry\s+(?:a\s+)?(?:note|paper)/i,
];

const REAL_ESTATE_PATTERNS = [
  /real\s+estate\s+included/i,
  /includes?\s+(?:the\s+)?real\s+estate/i,
  /including\s+(?:the\s+)?real\s+estate/i,
  /real\s+estate\s+owned/i,
  /with\s+(?:the\s+)?real\s+estate/i,
  /w\/\s*real\s+estate/i,
  /plus\s+real\s+estate/i,
  /\+\s*real\s+estate/i,
  /real\s+estate\s+\+/i,
  /business\s+and\s+real\s+estate/i,
  /real\s+estate\s+and\s+business/i,
  /property\s+included/i,
  /includes?\s+(?:the\s+)?property/i,
  /building\s+included/i,
  /includes?\s+(?:the\s+)?(?:building|land)/i,
  /land\s+included/i,
  /fee\s+simple/i,
  /own(?:s|ership of)?\s+the\s+(?:real\s+estate|building|property)/i,
  /real\s+estate\s+ownership/i,
];

const NEGATIVE_FINANCING = [
  /no\s+seller\s+financ/i,
  /seller\s+financ(?:e|ing)\s+not\s+available/i,
  /cash\s+only/i,
];

const NEGATIVE_REAL_ESTATE = [
  /real\s+estate\s+not\s+included/i,
  /does\s+not\s+include\s+(?:the\s+)?real\s+estate/i,
  /real\s+estate\s+available\s+separately/i,
  /lease\s+only/i,
  /leased\s+(?:facility|building|property)/i,
];

const LAND_ONLY_PATTERNS = [
  /development\s+site/i,
  /vacant\s+(?:land|lot|parcel|acreage|site)/i,
  /raw\s+land/i,
  /land\s+only\b/i,
  /(?:commercial|residential)\s+land\s+offered/i,
  /land\s+offered\s+at/i,
  /\d[\d.,]*\s+acres?\s+of\s+(?:commercial\s+|residential\s+)?land/i,
  /\bpad\s+site\b/i,
  /\bpotential\s+site\b/i,
];

const IMPROVED_PROPERTY_PATTERNS = [
  /\bexisting\s+buildings?\b/i,
  /\bthis\s+(?:retail|office|multifamily|industrial|hotel|motel|warehouse)\s+propert/i,
  /\b(?:multifamily|apartment|retail|office|industrial)\s+propert/i,
  /\b(?:restaurant|pizzeria|bar|motel|hotel|car\s+wash|laundromat|self-?storage|gas\s+station|convenience\s+store|funeral\s+home)\b/i,
  /\breal\s+estate\s+included\b/i,
  /\bbusiness\s+included\b/i,
  /\boperating\s+(?:business|shop|facility)\b/i,
  /\bfacility\b/i,
];

function collectHits(text, patterns) {
  const hits = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) hits.push(match[0].replace(/\s+/g, " ").trim());
  }
  return hits;
}

export function classify(text = "") {
  const hay = String(text);
  const financingHits = collectHits(hay, FINANCING_PATTERNS);
  const realEstateHits = collectHits(hay, REAL_ESTATE_PATTERNS);
  const negativeFinancing = collectHits(hay, NEGATIVE_FINANCING);
  const negativeRealEstate = collectHits(hay, NEGATIVE_REAL_ESTATE);
  const landHits = collectHits(hay, LAND_ONLY_PATTERNS);
  const improvedHits = collectHits(hay, IMPROVED_PROPERTY_PATTERNS);

  const sellerFinancing = financingHits.length > 0 && negativeFinancing.length === 0;
  const realEstateIncluded =
    realEstateHits.length > 0 && negativeRealEstate.length === 0;
  const landDeal = landHits.length > 0 && improvedHits.length === 0;

  let score = 0;
  if (sellerFinancing) score += 50;
  if (realEstateIncluded) score += 50;
  if (negativeFinancing.length || negativeRealEstate.length) score = Math.max(0, score - 40);
  if (landDeal) score = Math.max(0, score - 50);

  return {
    sellerFinancing,
    realEstateIncluded,
    landDeal,
    qualified: sellerFinancing && realEstateIncluded && !landDeal,
    score,
    financingEvidence: financingHits,
    realEstateEvidence: realEstateHits,
    negativeEvidence: [...negativeFinancing, ...negativeRealEstate, ...landHits],
  };
}

export function parsePrice(text = "") {
  const raw = String(text);
  const million = raw.match(/\$?\s*([0-9]+(?:\.[0-9]+)?)\s*million/i);
  if (million) return Math.round(Number(million[1]) * 1_000_000);

  const compact = raw.match(/\$\s*([0-9]+(?:\.[0-9]+)?)\s*([MK])\b/i);
  if (compact) {
    const n = Number(compact[1]);
    return Math.round(n * (compact[2].toUpperCase() === "M" ? 1_000_000 : 1_000));
  }

  const money = raw.match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?)/);
  if (money) return Math.round(Number(money[1].replace(/,/g, "")));

  const plain = raw.match(/\$\s*([0-9]{4,})/);
  if (plain) return Number(plain[1]);

  return null;
}

export function parseLocation(text = "") {
  const start = String(text).match(
    /^\s*([A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2})\s*[:\-–]/
  );
  if (start) return start[1].replace(/\s+/g, " ").trim();

  const cityState = String(text).match(
    /\b([A-Z][a-zA-Z .'-]+,\s*[A-Z]{2})\b/
  );
  if (cityState) return cityState[1].replace(/\s+/g, " ").trim();

  return null;
}

export { FINANCING_PATTERNS, REAL_ESTATE_PATTERNS, LAND_ONLY_PATTERNS };
