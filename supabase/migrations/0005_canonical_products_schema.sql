-- Migration: Canonical Products Schema Updates

-- 1. Make products fields nullable since we use deterministic extraction before AI
ALTER TABLE products ALTER COLUMN category_id DROP NOT NULL;
ALTER TABLE products ALTER COLUMN brand DROP NOT NULL;
ALTER TABLE products ALTER COLUMN model DROP NOT NULL;
ALTER TABLE products ALTER COLUMN name DROP NOT NULL;

-- 2. Create join table for Product <-> PDF Document
CREATE TABLE product_pdf_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  pdf_document_id UUID NOT NULL REFERENCES pdf_documents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, pdf_document_id)
);
CREATE INDEX idx_prod_pdf_product_id ON product_pdf_documents(product_id);
CREATE INDEX idx_prod_pdf_pdf_id ON product_pdf_documents(pdf_document_id);
ALTER TABLE product_pdf_documents ENABLE ROW LEVEL SECURITY;

-- 3. Link source identities back to canonical product
ALTER TABLE amazon_products ADD COLUMN product_id UUID REFERENCES products(id) ON DELETE SET NULL;
CREATE INDEX idx_amazon_products_product_id ON amazon_products(product_id);

ALTER TABLE flipkart_products ADD COLUMN product_id UUID REFERENCES products(id) ON DELETE SET NULL;
CREATE INDEX idx_flipkart_products_product_id ON flipkart_products(product_id);
