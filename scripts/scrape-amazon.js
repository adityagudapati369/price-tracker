// scripts/scrape-amazon.js
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { saveProductSnapshot } = require("./shared/writeToSupabase");

const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY;

function buildScraperApiUrl(targetUrl) {
  return `http://api.scraperapi.com?api_key=${SCRAPERAPI_KEY}&url=${encodeURIComponent(targetUrl)}&country_code=in`;
}

function extractASIN(url) {
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

  const res = await fetch(buildScraperApiUrl(url));

  if (!res.ok) {
    throw new Error(`Amazon fetch failed: HTTP ${res.status} for ASIN ${asin}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  if ($("form[action*='validateCaptcha']").length > 0 || /Enter the characters you see below/i.test(html)) {
    throw new Error(`Amazon blocked the request (CAPTCHA) for ASIN ${asin}`);
  }

  const title =
    $("#productTitle").text().trim() ||
    $("span#title").text().trim() ||
    $("h1.product-title-word-break").text().trim() ||
    null;

  const priceSelectors = [
    "#corePrice_feature_div .a-price .a-offscreen",
    "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen",
    ".priceToPay .a-offscreen",
    ".reinventPricePriceToPayMargin .a-offscreen",
    "span.a-price[data-a-size='xl'] .a-offscreen",
    "span.a-price .a-offscreen",
    "#priceblock_ourprice",
    "#priceblock_dealprice",
    "#tp_price_block_total_price_ww .a-offscreen",
  ];
  let priceText = null;
  for (const sel of priceSelectors) {
    const t = $(sel).first().text().trim();
    if (t) {
      priceText = t;
      break;
    }
  }
  let price = parsePrice(priceText);

  if (!price) {
    const bodyText = $("body").text();
    const match = bodyText.match(/₹\s?[\d,]+(?:\.\d{1,2})?/);
    if (match) {
      price = parsePrice(match[0]);
    }
  }

  const mrpSelectors = [
    "#corePriceDisplay_desktop_feature_div .a-text-price .a-offscreen",
    ".basisPrice .a-offscreen",
    "span.a-text-price .a-offscreen",
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
    $("#landingImage").attr("data-old-hires") ||
    null;

  const in_stock = !/currently unavailable/i.test(html);

  if (!price) {
    console.warn(`[amazon/${asin}] price selectors all failed. Title found: ${!!title}. HTML length: ${html.length}`);
  }

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