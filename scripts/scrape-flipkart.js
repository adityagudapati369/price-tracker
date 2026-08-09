// scripts/scrape-flipkart.js
// Fetches a Flipkart product page and extracts price/title/image.
// Usage: node scrape-flipkart.js <flipkart_product_url>

const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { saveProductSnapshot } = require("./shared/writeToSupabase");

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function extractFSN(url) {
  // Flipkart product IDs (pid) appear as a query param, e.g. ?pid=MOBFWQ6BZ...
  const u = new URL(url);
  const pid = u.searchParams.get("pid");
  if (pid) return pid;

  // Fallback: sometimes embedded in the path itself
  const match = url.match(/\/p\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

function parsePrice(text) {
  if (!text) return null;
  const cleaned = text.replace(/[^\d.]/g, "");
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

async function scrapeFlipkart(url) {
  const pid = extractFSN(url);
  if (!pid) {
    throw new Error(`Could not extract product id (pid) from URL: ${url}`);
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
    throw new Error(`Flipkart fetch failed: HTTP ${res.status} for pid ${pid}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // Flipkart's class names are obfuscated/change often — these selectors
  // are current as of build time but WILL need periodic re-checking.
  // Prefer JSON-LD structured data when present (more stable than CSS classes).
  let title = null;
  let price = null;
  let mrp = null;
  let image_url = null;

  // Try structured data first (most stable)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).contents().text());
      const obj = Array.isArray(json) ? json.find((j) => j["@type"] === "Product") : json;
      if (obj && obj["@type"] === "Product") {
        title = title || obj.name || null;
        image_url = image_url || (Array.isArray(obj.image) ? obj.image[0] : obj.image) || null;
        if (obj.offers) {
          const offer = Array.isArray(obj.offers) ? obj.offers[0] : obj.offers;
          price = price || parsePrice(String(offer.price || ""));
        }
      }
    } catch (e) {
      // ignore malformed JSON-LD blocks
    }
  });

  // Fallback to visible DOM text if structured data missing
  if (!title) {
    title = $("span.VU-ZEz").first().text().trim() || $("h1 span").first().text().trim() || null;
  }
  if (!price) {
    const priceText = $("div.Nx9bqj.CxhGGd").first().text().trim() || $("div._30jeq3").first().text().trim();
    price = parsePrice(priceText);
  }
  if (!mrp) {
    const mrpText = $("div.yRaY8j.A6\\+E6v").first().text().trim() || $("div._3I9_wc").first().text().trim();
    mrp = parsePrice(mrpText) || price;
  }
  if (!image_url) {
    image_url = $("img.DByuf4").first().attr("src") || null;
  }

  const in_stock = !/sold out|out of stock/i.test(html.slice(0, 20000));

  return {
    platform: "flipkart",
    product_id: pid,
    product_url: url,
    title,
    image_url,
    price,
    mrp,
    in_stock,
  };
}

if (require.main === module) {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: node scrape-flipkart.js <flipkart_product_url>");
    process.exit(1);
  }

  scrapeFlipkart(url)
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

module.exports = { scrapeFlipkart, extractFSN };
