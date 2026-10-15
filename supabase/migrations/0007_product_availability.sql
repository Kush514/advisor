-- Migration: Amazon availability tracking
-- Filled daily by apps/api/scripts/refresh-availability.ts. Only buyable products are recommendable.

ALTER TABLE products ADD COLUMN amazon_availability TEXT;      -- IN_STOCK, IN_STOCK_SCARCE, OUT_OF_STOCK, NOT_FOUND, ...
ALTER TABLE products ADD COLUMN availability_checked_at TIMESTAMPTZ;

CREATE INDEX idx_products_amazon_availability ON products(amazon_availability);
