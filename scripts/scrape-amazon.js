// scripts/scrape-amazon.js
// Fetches an Amazon.in product page and extracts price/title/image.
// Usage: node scrape-amazon.js <amazon_product_url>
// Or import scrapeAmazon(url) and call it from a batch runner.

const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { saveProductSnapshot } = require("./shared/writeToSupabase");

// Rotate a few realistic desktop user-agents to reduce bot-block chance.
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function extractASIN(url) {
  // Handles /dp/ASIN, /gp/product/ASIN, and query-string variants
  const match = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  return match ? match[1] : null;
}

function parsePrice(text) {
  if (!text) return null;
  const cleaned = text.replace(/[^\d.]/g, "");
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

async function scrapeAmazon(url) {
  const asin = extractASIN(url);
  if (!asin) {
    throw new Error(`Could not extract ASIN from URL: ${url}`);
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent": randomUA(),
      "Accept-Language": "en-IN,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    },
  });

  if (!res.ok) {
    throw new Error(`Amazon fetch failed: HTTP ${res.status} for ASIN ${asin}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // Basic bot-block detection — Amazon shows a CAPTCHA page when blocked
  if ($("form[action*='validateCaptcha']").length > 0 || /Enter the characters you see below/i.test(html)) {
    throw new Error(`Amazon blocked the request (CAPTCHA) for ASIN ${asin} — consider slowing scrape rate or rotating IP`);
  }

  const title = $("#productTitle").text().trim() || null;

  // Amazon has several possible price element selectors depending on layout
  const priceSelectors = [
    "#corePrice_feature_div .a-price .a-offscreen",
    "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen",
    ".priceToPay .a-offscreen",
    "#priceblock_ourprice",
    "#priceblock_dealprice",
  ];
  let priceText = null;
  for (const sel of priceSelectors) {
    const t = $(sel).first().text().trim();
    if (t) {
      priceText = t;
      break;
    }
  }
  const price = parsePrice(priceText);

  const mrpSelectors = [
    "#corePriceDisplay_desktop_feature_div .a-text-price .a-offscreen",
    ".basisPrice .a-offscreen",
  ];
  let mrpText = null;
  for (const sel of mrpSelectors) {
    const t = $(sel).first().text().trim();
    if (t) {
      mrpText = t;
      break;
    }
  }
  const mrp = parsePrice(mrpText) || price;

  const image_url =
    $("#landingImage").attr("src") ||
    $("#imgTagWrapperId img").attr("src") ||
    null;

  const in_stock = !/currently unavailable/i.test(html);

  return {
    platform: "amazon",
    product_id: asin,
    product_url: `https://www.amazon.in/dp/${asin}`,
    title,
    image_url,
    price,
    mrp,
    in_stock,
  };
}

// CLI entry point: node scrape-amazon.js <url>
if (require.main === module) {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: node scrape-amazon.js <amazon_product_url>");
    process.exit(1);
  }

  scrapeAmazon(url)
    .then(async (data) => {
      console.log("Scraped:", data);
      await saveProductSnapshot(data);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Error:", err.message);
      process.exit(1);
    });
}

module.exports = { scrapeAmazon, extractASIN };
