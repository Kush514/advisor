// Where the API lives. Empty (default) means the same address as the website, which is how local dev
// (Vite proxies /api) and a single-domain deployment (site + Worker route on /api/*) work.
// Set VITE_API_URL at build time when the API has its own address, e.g. https://vm-one-api.<you>.workers.dev
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export const apiUrl = (path: string) => `${API_BASE}${path}`;
