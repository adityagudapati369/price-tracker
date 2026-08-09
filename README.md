# PriceKeeda — India Price Tracker

Track Amazon & Flipkart prices (Myntra/Meesho coming in Phase 2). Free, no-server frontend + GitHub Actions scraper + Supabase backend.

## What's in this folder

```
price-tracker/
├── .github/workflows/scrape-prices.yml   ← runs the scraper every 5 hours automatically
├── scripts/
│   ├── shared/writeToSupabase.js         ← writes scraped data to Supabase
│   ├── scrape-amazon.js                  ← Amazon scraper (run standalone or via run-all.js)
│   ├── scrape-flipkart.js                ← Flipkart scraper
│   └── run-all.js                        ← scrapes every tracked product (called by GitHub Actions)
├── public/index.html                     ← the actual website (single file, like Groupverse)
├── supabase-schema.sql                   ← run this once in Supabase to create your tables
├── package.json
├── .env.example                          ← template for local testing
└── .gitignore
```

## Setup steps (do these in order)

### 1. Create the Supabase tables
- Go to your Supabase project → SQL Editor
- Paste the entire contents of `supabase-schema.sql` and run it
- This creates `products`, `price_history`, `alerts`, `rate_limits` tables with correct security rules

### 2. Get your Supabase keys
In Supabase Dashboard → Project Settings → API, you'll see two keys:
- **anon / public key** — safe to expose in the website (goes in `public/index.html`)
- **service_role key** — SECRET, never expose publicly. This goes only in GitHub Actions secrets.

### 3. Push this folder to GitHub
```bash
cd price-tracker
git init
git add .
git commit -m "Initial price tracker setup"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 4. Add GitHub Actions secrets
In your GitHub repo → Settings → Secrets and variables → Actions → New repository secret:
- `SUPABASE_URL` = your project URL (e.g. `https://xxxx.supabase.co`)
- `SUPABASE_SERVICE_KEY` = your service_role key from step 2

This lets the scraper (running for free on GitHub's servers) write price data on schedule.

### 5. Fill in the frontend config
Open `public/index.html`, find this block near the top:
```js
window.SUPABASE_URL = "https://your-project-ref.supabase.co";
window.SUPABASE_ANON_KEY = "your-anon-public-key-here";
```
Replace both with your real Supabase URL and **anon** key (not service_role).

### 6. Deploy the frontend
Same as Groupverse — drag `public/index.html` into Netlify, or connect the GitHub repo and set the publish directory to `public`.

### 7. Test the scraper manually before trusting the cron
```bash
npm install
node scripts/scrape-amazon.js "https://www.amazon.in/dp/SOME_ASIN"
node scripts/scrape-flipkart.js "https://www.flipkart.com/some-product/p/itmXXXX?pid=YYYY"
```
If these print scraped data without errors, you're good. If Amazon returns a CAPTCHA error, wait a while before retrying — it means too many requests came from the same IP.

### 8. Trigger the GitHub Actions workflow manually (optional, for testing)
Go to your repo → Actions tab → "Scrape Prices" → Run workflow. This runs immediately instead of waiting for the next 5-hour cycle.

## How tracking a new product actually works

1. User pastes a link on the website → it gets inserted into the `products` table with just the URL (no price yet)
2. On the next scrape cycle (up to 5 hours later), GitHub Actions picks it up, scrapes the real price/title/image, and fills in the row
3. From then on, every price change gets logged to `price_history`, which powers the graph

This keeps your frontend server-free — Netlify just serves static HTML, all the "backend" work happens in Supabase + GitHub Actions, both free.

## Known limitations (Phase 1 — be aware, not blockers)

- **Flipkart's CSS classes change periodically.** The scraper tries structured JSON-LD data first (more stable), with CSS as fallback. If Flipkart scraping starts failing, the selectors in `scrape-flipkart.js` need updating — this is normal and expected over time, not a bug.
- **Amazon may show CAPTCHA if scraped too frequently from the same IP.** GitHub Actions IPs rotate, but if this becomes a persistent issue, the fix is adding a proxy service (small ongoing cost) — not something to worry about until it happens.
- **No alert-sending yet.** The `alerts` table captures target prices, but nothing sends the Telegram message yet — that's the next thing we build (a small script that checks `alerts` against `current_price` after each scrape and messages via Telegram Bot API).
- **Myntra & Meesho are not implemented yet** — by design, per your Phase 1 → Phase 2 plan.

## What to ask for next

When you're ready, come back and ask for:
1. The Telegram alert-sending script (checks alerts table, messages users when target price is hit)
2. Coupon/bank-offer price detection (the "accurate pricing" differentiator)
3. Myntra + Meesho scrapers
4. SEO setup (same JSON-LD/schema pattern as Groupverse)
5. Freemium/subscription tiers
