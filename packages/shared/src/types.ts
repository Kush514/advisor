export interface HealthResponse {
  status: 'ok' | 'error';
  message: string;
}

export type ProductStatus = 'active' | 'archived' | 'discontinued' | 'unknown';

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  name: string;
  brand: string;
  model: string;
  category_id: string;
  subcategory: string | null;
  description: string | null;
  status: ProductStatus;
  reviewed_by_vmone: boolean;
  recommendable: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductSpec {
  id: string;
  product_id: string;
  spec_key: string;
  spec_value: string;
  spec_unit: string | null;
  created_at: string;
  updated_at: string;
}

export interface YouTubeVideo {
  id: string;
  youtube_video_id: string; // The ID from YouTube
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  youtube_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductVideo {
  id: string;
  product_id: string;
  youtube_video_id: string; // Foreign key to youtube_videos.id
  created_at: string;
}

export interface ProductLink {
  id: string;
  product_id: string;
  amazon_url: string | null;
  flipkart_url: string | null;
  brand_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuestionTemplate {
  id: string;
  category_id: string;
  question_key: string;
  question_text: string;
  question_type: string; // e.g. 'select', 'multiselect', 'number'
  options: any | null; // JSONB array of options if applicable
  required: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}
