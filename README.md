# VM One Product Advisor

VM One Product Advisor is a web application that recommends ONLY products that are verified as reviewed by VM One. 

## Current Architecture
The project is set up as a monorepo using npm workspaces:

- `apps/web`: React + Vite + TypeScript frontend. Styled with Tailwind CSS.
- `apps/api`: Cloudflare Workers backend (TypeScript).
- `packages/shared`: Shared TypeScript types and utilities between frontend and backend.

*Note: External integrations (Supabase, YouTube Data API, Gemini API) are not connected yet.*

## Installation

1. Install dependencies from the root:
```bash
npm install
```

## Development

Run frontend and backend in development mode:
```bash
# In separate terminals, or use concurrent scripts if configured
npm run dev:web
npm run dev:api
```

## Build
```bash
npm run build
```

## Current Status
Phase 0/1 foundation is initialized. The repository structure is ready for feature development.
