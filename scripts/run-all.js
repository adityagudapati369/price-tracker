// scripts/run-all.js
// Pulls every tracked product from Supabase, re-scrapes it based on
// its platform, and writes the fresh snapshot back.
// This is what the GitHub Actions cron actually calls.

const { supabase, saveProductSnapshot } = require("./shared/writeToSupabase");
const { scrapeAmazon } = require("./scrape-amazon");
const { scrapeFlipkart } = require("./scrape-flipkart");

const SCRAPERS = {
  amazon: scrapeAmazon,
  flipkart: scrapeFlipkart,
  // myntra: scrapeMyntra,   // added in Phase 2
  // meesho: scrapeMeesho,   // added in Phase 2
};

// Small delay between requests to reduce bot-block risk.
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runAll() {
  const { data: products, error } = await supabase
    .from("products")
    .select("id, platform, product_url, product_id");

  if (error) {
    console.error("Failed to fetch products list:", error.message);
    process.exit(1);
  }

  console.log(`Found ${products.length} tracked products to refresh.`);

  let ok = 0;
  let failed = 0;

  for (const p of products) {
    const scraper = SCRAPERS[p.platform];
    if (!scraper) {
      console.warn(`No scraper implemented yet for platform "${p.platform}" — skipping ${p.product_id}`);
      continue;
    }

    try {
      const fresh = await scraper(p.product_url);
      await saveProductSnapshot(fresh);
      ok++;
    } catch (err) {
      failed++;
      console.error(`Failed to scrape ${p.platform}/${p.product_id}: ${err.message}`);
    }

    // Randomised delay (2-5s) between requests — polite scraping,
    // reduces chance of triggering rate-based bot detection.
    await sleep(2000 + Math.random() * 3000);
  }

  console.log(`Done. ${ok} succeeded, ${failed} failed out of ${products.length}.`);
}

runAll().catch((err) => {
  console.error("Fatal error in run-all:", err);
  process.exit(1);
});
