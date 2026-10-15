-- Migration: Amazon Products

CREATE TABLE amazon_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asin TEXT UNIQUE,
  canonical_url TEXT NOT NULL,
  marketplace_domain TEXT,
  status TEXT NOT NULL DEFAULT 'unresolved',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_amazon_products_asin ON amazon_products(asin);
CREATE INDEX idx_amazon_products_status ON amazon_products(status);

ALTER TABLE youtube_video_links ADD COLUMN amazon_product_id UUID REFERENCES amazon_products(id) ON DELETE SET NULL;
CREATE INDEX idx_yv_links_amazon_prod ON youtube_video_links(amazon_product_id);

ALTER TABLE amazon_products ENABLE ROW LEVEL SECURITY;
