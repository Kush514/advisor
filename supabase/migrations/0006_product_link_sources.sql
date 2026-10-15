-- Migration: Track ASIN and link origin for Amazon product links
-- VM One's original Amazon affiliate links (amzn.to, link.amazon, ...) are stored as-is,
-- so the ASIN can no longer be parsed from amazon_url and is kept in its own column.

ALTER TABLE product_links ADD COLUMN asin TEXT;
-- 'vmone_original' = working link with a tracking ID, taken unchanged from a VM One video description / PDF
-- 'generated'      = amazon.in/dp/ASIN?tag=vmone-21, used when no working tagged original exists
ALTER TABLE product_links ADD COLUMN amazon_link_source TEXT;

CREATE INDEX idx_product_links_asin ON product_links(asin);
