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

## Put it on your phone

This is a website you install like an app. It is not in the App Store / Play Store. GitHub only holds the code.

1. **Put it on your VPS** with a public HTTPS address (see below). Your phone cannot open `localhost` on the VPS.
2. On your phone, open that URL in Safari (iPhone) or Chrome (Android).
3. **Add to Home Screen**:
   - iPhone: Share → **Add to Home Screen**
   - Android: menu → **Install app** or **Add to Home Screen**

After that it has an icon and opens full-screen, like a normal app.

You still need a host that stays online. A home-screen icon is a shortcut to that live site.

## Deploy on DigitalOcean

Your CRM Droplet is the right DigitalOcean product. **Do not use App Platform** for this app: its disk is wiped on every deploy, and the SQLite deal list would disappear.

On the Droplet (Ubuntu), as root:

```bash
apt-get update
apt-get install -y git nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

git clone https://github.com/deleondiego9/deal-scout.git /opt/deal-scout
cd /opt/deal-scout
cp .env.example .env
# edit .env and set a real API_KEY
npm ci --omit=dev

cp deploy/deal-scout.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now deal-scout
```

If you already use Docker on the Droplet:

```bash
git clone https://github.com/deleondiego9/deal-scout.git /opt/deal-scout
cd /opt/deal-scout
cp .env.example .env
# set API_KEY in .env
docker compose up -d --build
```

Then put HTTPS in front. Copy `deploy/nginx.conf.example` to `/etc/nginx/sites-available/deal-scout`, change `deals.example.com` to your subdomain, enable the site, and run Certbot:

```bash
ln -s /etc/nginx/sites-available/deal-scout /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d deals.yourdomain.com
```

Point that subdomain’s DNS A record at the Droplet in DigitalOcean Networking → Domains.

Scan every 6 hours:

```cron
0 */6 * * * cd /opt/deal-scout && /usr/bin/npm run scan >> /var/log/deal-scout-scan.log 2>&1
```

With Docker, use:

```cron
0 */6 * * * docker compose -f /opt/deal-scout/docker-compose.yml exec -T deal-scout node scripts/scan.js >> /var/log/deal-scout-scan.log 2>&1
```

Open `https://deals.yourdomain.com` on your phone, then Add to Home Screen.

## Cursor agent ingest

A Cursor agent can hunt for listings, then post only new ones:

1. `GET /api/deals?url=<listing-url>` — if `known` is true, skip
2. `POST /api/deals` with the JSON body below

See `AGENTS.md` for the exact prompt and payload.

## GitHub Action

`.github/workflows/test.yml` runs the test suite on every push.

`.github/workflows/scan.yml` searches Bing and DuckDuckGo **from GitHub’s IP** (the Droplet is often blocked), then imports matches into the live app. Add repo secrets:

- `APP_URL` — e.g. `https://deleonleads.duckdns.org/deals`
- `API_KEY` — same key as the server

That is the “every so often” part. Cursor agents do not cron themselves; the app/cron/Action does.

Respect each marketplace’s terms of use. This is a lightweight public-search helper, not a full scrape of those sites.
