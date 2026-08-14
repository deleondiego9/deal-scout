# Agent instructions for Deal Scout

You are collecting **businesses for sale** that match both:

1. Real estate is included (building/land/property comes with the business)
2. Seller / owner financing is offered

Do not collect lease-only businesses, cash-only ads, or listings where real estate is sold separately.

## Before posting a listing

Call the running app:

```
GET {APP_URL}/api/deals?url={listingUrl}
```

If `known` is `true`, skip it. Never post a duplicate.

## Post a new listing

```
POST {APP_URL}/api/deals
Content-Type: application/json
X-API-Key: {API_KEY}
```

```json
{
  "url": "https://www.bizbuysell.com/business-opportunity/example/123456/",
  "title": "Car wash + real estate",
  "location": "Pomeroy, OH",
  "priceText": "$1,000,000",
  "description": "Seller financing available. Real estate included.",
  "origin": "agent"
}
```

Optional fields: `html` (raw listing HTML), `sellerFinancing`, `realEstateIncluded`, `priceAmount`.

The server canonicalizes the URL, classifies the text, and ignores repeats.

## Search suggestions

Use public search, not login walls:

- `site:bizbuysell.com "seller financing" "real estate included"`
- `site:bizbuysell.com "owner financing" "includes real estate"`
- `site:bizquest.com "seller financing" "real estate included"`

Prefer listing detail URLs that contain a numeric id. Skip learning-center articles and search-result pages.

## Local scan without posting

If you are in this repo, run `npm run scan` instead of hand-copying URLs. That uses the same dedupe database.
