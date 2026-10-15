-- Migration: PDF Documents

CREATE TABLE pdf_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resolved_url TEXT NOT NULL,
  content_hash TEXT UNIQUE NOT NULL,
  title TEXT,
  file_size INTEGER,
  page_count INTEGER,
  extracted_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pdf_docs_hash ON pdf_documents(content_hash);
CREATE INDEX idx_pdf_docs_status ON pdf_documents(status);

ALTER TABLE youtube_video_links ADD COLUMN pdf_document_id UUID REFERENCES pdf_documents(id) ON DELETE SET NULL;
CREATE INDEX idx_yv_links_pdf_doc ON youtube_video_links(pdf_document_id);

ALTER TABLE pdf_documents ENABLE ROW LEVEL SECURITY;
