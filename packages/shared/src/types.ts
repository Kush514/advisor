export interface HealthResponse {
  status: 'ok' | 'error';
  message: string;
}

// Placeholder for future product/recommendation types
export interface Product {
  id: string;
  name: string;
  reviewed_by_vmone: boolean;
}
