// scripts/scrape-flipkart.js
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { saveProductSnapshot } = require("./shared/writeToSupabase");

const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY;

function buildScraperApiUrl(targetUrl) {
  return `http://api.scraperapi.com?api_key=${SCRAPERAPI_KEY}&url=${encodeURIComponent(targetUrl)}&country_code=in`;
}

function isShortLink(url) {
  return /dl\.flipkart\.com|fkrt\.(co|it)/i.test(url);
}

async function resolveShortLink(url) {
  const res = await fetch(buildScraperApiUrl(url));
  return res.url || url;
}

function extractFSN(url) {
  const u = new URL(url);
  const pid = u.searchParams.get("pid");
  if (pid) return pid;

  const match = url.match(/\/p\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

function parsePrice(text) {
  if (!text) return null;
  const cleaned = text.replace(/[^\d.]/g, "");
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

async function scrapeFlipkart(inputUrl) {
  let url = inputUrl;
  if (isShortLink(inputUrl)) {
    url = await resolveShortLink(inputUrl);
    console.log(`Resolved short link ${inputUrl} → ${url}`);
  }

  const pid = extractFSN(url);
  if (!pid) {
    throw new Error(`Could not extract product id (pid) from URL: ${url} (original: ${inputUrl})`);
  }

  const res = await fetch(buildScraperApiUrl(url));

  if (!res.ok) {
    throw new Error(`Flipkart fetch failed: HTTP ${res.status} for pid ${pid}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  let title = null;
  let price = null;
  let mrp = null;
  let image_url = null;

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
    } catch (e) {}
  });

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

module.exports = { scrapeFlipkart, extractFSN, isShortLink, resolveShortLink };