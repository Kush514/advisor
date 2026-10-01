-- Initial Schema for VM One Product Advisor

-- Enums
CREATE TYPE product_status AS ENUM ('active', 'archived', 'discontinued', 'unknown');

-- 1. categories
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. products
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  subcategory TEXT,
  description TEXT,
  status product_status NOT NULL DEFAULT 'unknown',
  reviewed_by_vmone BOOLEAN NOT NULL DEFAULT false,
  recommendable BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. product_specs
CREATE TABLE product_specs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  spec_key TEXT NOT NULL,
  spec_value TEXT NOT NULL,
  spec_unit TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, spec_key)
);

-- 4. youtube_videos
CREATE TABLE youtube_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_video_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  published_at TIMESTAMPTZ,
  youtube_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. product_videos (many-to-many)
CREATE TABLE product_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  youtube_video_id UUID NOT NULL REFERENCES youtube_videos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, youtube_video_id)
);

-- 6. product_links
CREATE TABLE product_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  amazon_url TEXT,
  flipkart_url TEXT,
  brand_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. question_templates
CREATE TABLE question_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL,
  options JSONB,
  required BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Indexes for Performance
CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_products_brand ON products(brand);
CREATE INDEX idx_products_model ON products(model);
CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_products_reviewed_recommendable ON products(reviewed_by_vmone, recommendable);

CREATE INDEX idx_product_specs_product_id ON product_specs(product_id);
CREATE INDEX idx_product_specs_spec_key ON product_specs(spec_key);

CREATE INDEX idx_youtube_videos_yt_id ON youtube_videos(youtube_video_id);

CREATE INDEX idx_product_videos_product_id ON product_videos(product_id);
CREATE INDEX idx_product_videos_youtube_video_id ON product_videos(youtube_video_id);

CREATE INDEX idx_question_templates_category_id ON question_templates(category_id);
CREATE INDEX idx_question_templates_display_order ON question_templates(display_order);


-- Row Level Security (RLS)
-- We enable RLS on all tables to deny direct client access by default.
-- All access from our frontend will happen through our Cloudflare Worker using the Service Role key (which bypasses RLS).
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE youtube_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_templates ENABLE ROW LEVEL SECURITY;

-- Note: No policies are created here because we intentionally want to block anon/authenticated users from direct access.
-- The Service Role key ignores RLS policies.
