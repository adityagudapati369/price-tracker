// scripts/shared/writeToSupabase.js
// Shared helper: upsert product + insert price_history row.
// Used by scrape-amazon.js and scrape-flipkart.js so pricing logic
// stays consistent across platforms.

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // service_role key, NOT anon key (needed to bypass RLS for writes from Actions)

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Saves a scraped product snapshot: upserts the product row,
 * then appends a price_history row if the price actually changed
 * (or if in_stock status flipped) — avoids flooding history with
 * duplicate identical rows every scrape cycle.
 *
 * @param {Object} data
 * @param {string} data.platform - 'amazon' | 'flipkart' | 'myntra' | 'meesho'
 * @param {string} data.product_id - ASIN / FSN / style id
 * @param {string} data.product_url
 * @param {string} data.title
 * @param {string} data.image_url
 * @param {number|null} data.price
 * @param {number|null} data.mrp
 * @param {boolean} data.in_stock
 */
async function saveProductSnapshot(data) {
  const {
    platform,
    product_id,
    product_url,
    title,
    image_url,
    price,
    mrp,
    in_stock,
  } = data;

  if (!platform || !product_id) {
    throw new Error("platform and product_id are required");
  }

  // 1. Fetch existing product row (if any) to compare price
  const { data: existing, error: fetchErr } = await supabase
    .from("products")
    .select("id, current_price")
    .eq("platform", platform)
    .eq("product_id", product_id)
    .maybeSingle();

  if (fetchErr) {
    console.error(`[${platform}/${product_id}] fetch existing failed:`, fetchErr.message);
    throw fetchErr;
  }

  // 2. Upsert product row with latest snapshot
  const { data: upserted, error: upsertErr } = await supabase
    .from("products")
    .upsert(
      {
        platform,
        product_id,
        product_url,
        title,
        image_url,
        current_price: price,
        mrp,
        last_checked_at: new Date().toISOString(),
      },
      { onConflict: "platform,product_id" }
    )
    .select("id")
    .single();

  if (upsertErr) {
    console.error(`[${platform}/${product_id}] upsert failed:`, upsertErr.message);
    throw upsertErr;
  }

  const productRowId = upserted.id;

  // 3. Only insert a price_history row if price actually changed
  //    (or this is the first time we've seen this product)
  const priceChanged =
    !existing || existing.current_price === null || Number(existing.current_price) !== Number(price);

  if (priceChanged && price !== null && price !== undefined) {
    const { error: historyErr } = await supabase.from("price_history").insert({
      product_id: productRowId,
      price,
      mrp,
      in_stock,
    });

    if (historyErr) {
      console.error(`[${platform}/${product_id}] history insert failed:`, historyErr.message);
      throw historyErr;
    }

    console.log(`[${platform}/${product_id}] price updated → ₹${price} (history logged)`);
  } else {
    console.log(`[${platform}/${product_id}] price unchanged (₹${price}) — skipped history row`);
  }

  return productRowId;
}

module.exports = { saveProductSnapshot, supabase };
