# VM One Product Advisor

VM One Product Advisor is a web application that recommends ONLY products that are verified as reviewed by VM One. 

## Current Architecture
The project is set up as a monorepo using npm workspaces:

- `apps/web`: React + Vite + TypeScript frontend. Styled with Tailwind CSS.
- `apps/api`: Cloudflare Workers backend (TypeScript).
- `packages/shared`: Shared TypeScript types and utilities between frontend and backend.

Data comes from the VM One YouTube channel (video descriptions and PDF buying guides), is stored in
Supabase, cleaned with Gemini, and priced through the Amazon Creators API.

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

## Deployment

Live at **https://vm-one-api.vmone-advisor.workers.dev**: one Cloudflare Worker (`apps/api`) serves
both the API (`/api/*`) and the website (`apps/web/dist`, via Workers static assets). The database is
Supabase.

`.github/workflows/deploy.yml` redeploys automatically on every push to `main` that touches the website,
API or shared code (typecheck → build → `wrangler deploy` → live smoke test). It uses the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets. Worker secrets (Supabase, Amazon,
admin key) live on Cloudflare and are kept across deploys. Manual deploy: `npm run build:shared &&
npm run build:web && cd apps/api && npx wrangler deploy`.

## Automatic sync

`.github/workflows/auto-sync.yml` keeps the product data up to date with no manual steps:

- **Every 4 hours** it checks the VM One channel. When a new video is found, the product links in its
  description become products (name, specs and category cleaned with Gemini), the video is attached to
  them, and new products get VM One's original Amazon link (`amazon.in/dp/ASIN?tag=vmone-21` only when
  no working original exists). PDF links are not followed by the automatic run.
- **Every day at 06:00 IST** prices and stock are refreshed for all products, only buyable products are
  shown (one per product), and the budget ranges are rebuilt.
- Size/type and preference questions are built live from the products, so they need no regeneration.
- Users also see live Amazon prices: `/api/ask` re-checks price and stock of the results it returns.

It can also be started by hand: GitHub → Actions → **VM One auto-sync** → Run workflow
(`check`, `refresh`, or `force`). Locally: `cd apps/api && npx tsx scripts/auto-sync.ts [--refresh] [--force]`.

### Required GitHub secrets

Settings → Secrets and variables → Actions → New repository secret, one per value in `apps/api/.dev.vars`:

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `YOUTUBE_API_KEY`, `GEMINI_API_KEY`,
`AMAZON_CREATORS_CLIENT_ID`, `AMAZON_CREATORS_CLIENT_SECRET`, `AMAZON_CREATORS_PARTNER_TAG`,
`AMAZON_CREATORS_ENDPOINT`

The same Amazon values must also be set on the deployed API (`wrangler secret put ...`) for live prices.
