-- Migration: YouTube Video Links

CREATE TYPE link_type AS ENUM (
  'amazon', 
  'flipkart', 
  'youtube', 
  'pdf_candidate', 
  'shortened', 
  'brand_or_external', 
  'other'
);

CREATE TABLE youtube_video_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_video_id UUID NOT NULL REFERENCES youtube_videos(id) ON DELETE CASCADE,
  original_url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  link_type link_type NOT NULL DEFAULT 'other',
  position INTEGER NOT NULL,
  context_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(youtube_video_id, normalized_url)
);

CREATE INDEX idx_yv_links_video_id ON youtube_video_links(youtube_video_id);
CREATE INDEX idx_yv_links_type ON youtube_video_links(link_type);

ALTER TABLE youtube_video_links ENABLE ROW LEVEL SECURITY;
