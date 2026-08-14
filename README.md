# Deal Scout

Web app that finds **businesses for sale with real estate included and seller financing**, stores each listing once, and shows them in a simple board.

It does **not** replace a VPS. GitHub holds the code. This app (on your laptop or VPS) holds the deals.

## What it does

- Searches public web results (DuckDuckGo HTML) for marketplace listings
- Keeps listings that look like they include real estate **and** seller financing
- Skips URLs it has already seen, so scans do not repeat cards
- Accepts extra deals from a Cursor agent via `POST /api/deals`
- Lets you save or dismiss deals in the UI

Marketplace sites often block direct page fetches. The scanner therefore uses **search titles and snippets**, which usually already say “real estate included” and “seller financing”. A Cursor agent can still open a listing in a browser and post richer details.

## Run locally

Needs Node.js 22+.

```bash
cp .env.example .env
npm install
npm test
npm start
```

Open [http://localhost:3000](http://localhost:3000). Click **Scan now**, or:

```bash
npm run scan
```

## Deploy on your VPS

```bash
git clone <this-repo>
cd deal-scout
cp .env.example .env
# set a real API_KEY in .env
npm install
npm start
```

Scan every 6 hours with cron:

```cron
0 */6 * * * cd /opt/deal-scout && /usr/bin/npm run scan >> /var/log/deal-scout-scan.log 2>&1
```

Or use the included `Dockerfile`.

Set `API_KEY` in production. The UI has an API key field; paste the same value so **Scan now** and agent posts are accepted.

## Cursor agent ingest

A Cursor agent can hunt for listings, then post only new ones:

1. `GET /api/deals?url=<listing-url>` — if `known` is true, skip
2. `POST /api/deals` with the JSON body below

See `AGENTS.md` for the exact prompt and payload.

## GitHub Action

`.github/workflows/test.yml` runs the test suite on every push.

`.github/workflows/scan.yml` can call your deployed app every 6 hours if you add repo secrets:

- `APP_URL` — e.g. `https://deals.example.com`
- `API_KEY` — same key as the server

That is the “every so often” part. Cursor agents do not cron themselves; the app/cron/Action does.

Respect each marketplace’s terms of use. This is a lightweight public-search helper, not a full scrape of those sites.
