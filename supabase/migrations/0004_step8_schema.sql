-- Migration: Step 8 Schema Additions

CREATE TABLE flipkart_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_identifier TEXT UNIQUE,
  canonical_url TEXT NOT NULL,
  marketplace_domain TEXT,
  status TEXT NOT NULL DEFAULT 'unresolved',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_flipkart_products_pid ON flipkart_products(product_identifier);
CREATE INDEX idx_flipkart_products_status ON flipkart_products(status);
ALTER TABLE flipkart_products ENABLE ROW LEVEL SECURITY;

CREATE TABLE pdf_document_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pdf_document_id UUID REFERENCES pdf_documents(id) ON DELETE CASCADE NOT NULL,
  original_url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  link_type TEXT NOT NULL,
  position INTEGER NOT NULL,
  context_text TEXT,
  amazon_product_id UUID REFERENCES amazon_products(id) ON DELETE SET NULL,
  flipkart_product_id UUID REFERENCES flipkart_products(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pdf_links_doc ON pdf_document_links(pdf_document_id);
CREATE INDEX idx_pdf_links_amazon ON pdf_document_links(amazon_product_id);
CREATE INDEX idx_pdf_links_flipkart ON pdf_document_links(flipkart_product_id);
ALTER TABLE pdf_document_links ENABLE ROW LEVEL SECURITY;

ALTER TABLE youtube_video_links ADD COLUMN flipkart_product_id UUID REFERENCES flipkart_products(id) ON DELETE SET NULL;
CREATE INDEX idx_yv_links_flipkart_prod ON youtube_video_links(flipkart_product_id);
