-- ============================================================
-- PriceKeeda — Supabase schema
-- Run this once in Supabase Dashboard > SQL Editor
-- ============================================================

-- Products being tracked
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('amazon','flipkart','myntra','meesho')),
  product_url text not null,
  product_id text not null, -- ASIN / FSN / style-id / product-id
  title text,
  image_url text,
  current_price numeric,
  mrp numeric,
  currency text default 'INR',
  last_checked_at timestamptz,
  created_at timestamptz default now(),
  unique(platform, product_id)
);

-- Price history log (one row per price CHANGE, not every scrape)
create table if not exists price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  price numeric not null,
  mrp numeric,
  in_stock boolean default true,
  recorded_at timestamptz default now()
);

-- Users tracking specific products for alerts
create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  contact_method text check (contact_method in ('telegram','whatsapp','email')),
  contact_value text not null, -- telegram chat_id / phone / email
  target_price numeric,
  triggered boolean default false,
  created_at timestamptz default now()
);

-- Rate limiting (same pattern as Groupverse)
create table if not exists rate_limits (
  id uuid primary key default gen_random_uuid(),
  identifier text not null, -- IP or user id
  action text not null,
  count int default 1,
  window_start timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table products enable row level security;
alter table price_history enable row level security;
alter table alerts enable row level security;
alter table rate_limits enable row level security;

-- Public (anon key) can READ products and price history — needed for the frontend
create policy "public read products" on products
  for select using (true);

create policy "public read price_history" on price_history
  for select using (true);

-- Public (anon key) can INSERT new products (submit a link to track)
-- and INSERT alerts (set a price alert). No public UPDATE/DELETE.
create policy "public insert products" on products
  for insert with check (true);

create policy "public insert alerts" on alerts
  for insert with check (true);

-- price_history and rate_limits writes are done ONLY by the scraper
-- using the service_role key, which bypasses RLS entirely — so no
-- public insert policy is needed for those tables.

-- Recommended index for the alert-checking job (Phase 2)
create index if not exists idx_alerts_product_id on alerts(product_id);
create index if not exists idx_price_history_product_id on price_history(product_id);
