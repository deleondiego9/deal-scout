const MONTHS = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

const MAX_DAYS = 5000;

function utcDate(year, month, day) {
  const dt = new Date(Date.UTC(year, month, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month || dt.getUTCDate() !== day) return null;
  return dt;
}

export function parseDateToIso(value, now = new Date()) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    if (value.getTime() > now.getTime() + 86400000) return null;
    return value.toISOString();
  }
  const raw = String(value).trim();
  if (!raw) return null;

  let year;
  let month;
  let day;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]) - 1;
    day = Number(iso[3]);
  } else {
    const named = raw.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
    if (named) {
      const monthIndex = MONTHS[named[1].toLowerCase()];
      if (monthIndex == null) return null;
      year = Number(named[3]);
      month = monthIndex;
      day = Number(named[2]);
    } else {
      const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (!slash) return null;
      month = Number(slash[1]) - 1;
      day = Number(slash[2]);
      year = Number(slash[3]);
      if (year < 100) year += 2000;
    }
  }

  if (year < 1990 || year > now.getUTCFullYear() + 1 || month < 0 || month > 11 || day < 1 || day > 31) {
    return null;
  }
  const dt = utcDate(year, month, day);
  if (!dt || dt.getTime() > now.getTime() + 86400000) return null;
  return dt.toISOString();
}

export function listedAtFromDaysOnMarket(days, now = new Date()) {
  const n = Number(days);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 0 || rounded > MAX_DAYS) return null;
  return new Date(now.getTime() - rounded * 86400000).toISOString();
}

export function daysOnMarket(listedAt, now = new Date()) {
  const start = Date.parse(listedAt);
  if (!Number.isFinite(start)) return null;
  const days = Math.floor((now.getTime() - start) / 86400000);
  if (days < 0 || days > MAX_DAYS) return null;
  return days;
}

export function earlierListedAt(left, right) {
  const a = parseDateToIso(left);
  const b = parseDateToIso(right);
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

export function parseListedAt(text, now = new Date()) {
  const src = String(text || "");
  if (!src.trim()) return null;

  const count =
    src.match(/(\d{1,4})\s*days?\s+on\s+(?:the\s+)?(?:market|loopnet|bizbuysell)\b/i) ||
    src.match(/\bdays?\s+on\s+(?:the\s+)?(?:market|loopnet|bizbuysell)\s*[:#-]?\s*(\d{1,4})\b/i) ||
    src.match(/\bon\s+(?:the\s+)?market\s*(?:for|:)?\s*(\d{1,4})\s*days?\b/i) ||
    src.match(/\blisted\s+(\d{1,4})\s+days?\s+ago\b/i) ||
    src.match(/\bDOM\s*[:#-]?\s*(\d{1,4})\b/i);
  if (count) {
    return listedAtFromDaysOnMarket(count[1], now);
  }

  const labeled = src.match(
    /(?:date\s*listed|listed\s*on|listing\s*date|on\s+(?:the\s+)?market\s+since|on\s+loopnet\s+since|listed)\s*[:\-]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i
  );
  if (labeled) return parseDateToIso(labeled[1], now);

  return null;
}

export function listedAtFromInput(input = {}, now = new Date()) {
  if (input.listedAt) {
    const fromField = parseDateToIso(input.listedAt, now) || parseListedAt(String(input.listedAt), now);
    if (fromField) return fromField;
  }
  if (input.daysOnMarket != null && input.daysOnMarket !== "") {
    const fromDays = listedAtFromDaysOnMarket(input.daysOnMarket, now);
    if (fromDays) return fromDays;
  }
  return parseListedAt(
    [input.title, input.snippet, input.description, input.excerpt, input.html].filter(Boolean).join("\n"),
    now
  );
}
