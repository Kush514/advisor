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

export type LinkType = 'amazon' | 'flipkart' | 'youtube' | 'pdf_candidate' | 'shortened' | 'brand_or_external' | 'other';

export interface PdfDocument {
  id: string;
  resolved_url: string;
  content_hash: string;
  title: string | null;
  file_size: number | null;
  page_count: number | null;
  extracted_text: string | null;
  status: 'pending' | 'downloaded' | 'extracted' | 'failed' | 'too_large' | 'not_a_pdf';
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface AmazonProduct {
  id: string;
  asin: string | null;
  canonical_url: string;
  marketplace_domain: string | null;
  status: 'resolved' | 'unresolved' | 'invalid' | 'failed';
  created_at: string;
  updated_at: string;
}

export interface FlipkartProduct {
  id: string;
  product_identifier: string | null;
  canonical_url: string;
  marketplace_domain: string | null;
  status: 'resolved' | 'unresolved' | 'failed';
  created_at: string;
  updated_at: string;
}

export interface PdfDocumentLink {
  id: string;
  pdf_document_id: string;
  original_url: string;
  normalized_url: string;
  link_type: LinkType;
  position: number;
  context_text: string | null;
  amazon_product_id: string | null;
  flipkart_product_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface YouTubeVideoLink {
  id: string;
  youtube_video_id: string;
  pdf_document_id: string | null;
  amazon_product_id: string | null;
  flipkart_product_id: string | null;
  original_url: string;
  normalized_url: string;
  link_type: LinkType;
  position: number;
  context_text: string | null;
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
export type BudgetRequirement = 
  | { kind: "range"; min?: number; max?: number }
  | { kind: "group"; value: string };

export type ProductRequirements = {
  category?: string;
  budget?: BudgetRequirement;
  brand?: string[];
  model?: string;
  features?: string[];
  /** Strict filters on the category's key attributes (see apps/api/src/services/attributes.ts) */
  attributes?: {
    size?: { min: number; max: number };
    type?: string;
  };
  /** Soft preferences (see apps/api/src/services/preferences.ts): matching products rank higher */
  preferences?: { key: string; value: string }[];
  query?: string;
};

export type VMOneContentClassification = 
  | "EXACT_PRODUCT"
  | "RELEVANT_PRODUCT_TYPE"
  | "RELEVANT_CATEGORY"
  | "RELEVANT_USE_CASE"
  | "NO_RELEVANT_CONTENT";

export type VMOneContent = {
  classification: VMOneContentClassification;
  video: {
    id: string;
    title: string | null;
    thumbnailUrl: string | null;
    youtubeUrl: string | null;
  } | null;
};

export type FinderProduct = {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  category: string;
  subcategory: string | null;
  imageUrl: string | null;
  /** Amazon product ID, used for live price checks */
  asin?: string | null;
  price: {
    amount: number | null;
    currency: "INR";
    source: string | null;
    /** true when the amount was fetched from Amazon for this request */
    live?: boolean;
    /** when the live price was checked (ISO time), null if it is the stored price */
    checkedAt?: string | null;
  };
  links: {
    amazon: string | null;
    flipkart: string | null;
    brand: string | null;
  };
  match: {
    score: number;
    maxScore: number | null;
    percentage: number;
  };
  whyItMatches: {
    matched: string[];
    unmatched: string[];
  };
  vmOneContent: VMOneContent;
};

export type RecommendationResponse = {
  ok: boolean;
  status: 'needs_information' | 'ready';
  message: string;
  requirements: ProductRequirements;
  suggested_replies: string[];
  products: FinderProduct[];
};

export interface QuestionOption {
  label: string;
  value: string;
}

export interface QuestionTemplateResponse {
  questionKey: string;
  questionText: string;
  questionType: string;
  options: QuestionOption[] | null;
  required: boolean;
  displayOrder: number;
}

export interface CategoryQuestionsResponse {
  ok: boolean;
  category: { slug: string; name: string };
  questions: QuestionTemplateResponse[];
  error?: string;
}

export interface FinderState {
  status: 'IDLE' | 'CATEGORY_SELECTED' | 'QUESTIONS_LOADING' | 'QUESTIONNAIRE_READY' | 'ANSWERING' | 'SUBMITTING' | 'RESULTS' | 'QUESTIONS_ERROR' | 'SUBMISSION_ERROR';
  categorySlug: string | null;
  categoryName: string | null;
  questions: QuestionTemplateResponse[];
  currentQuestionIndex: number;
  answers: Record<string, string | string[]>;
  results: FinderProduct[];
  error: string | null;
}
