# Model Browser (Next.js + Vercel)

This repo converts the original Python TUI model explorer into a web app that runs on Next.js and deploys cleanly on Vercel.

## What it does

- Loads provider cache files from `results_*.json`
- Persists model data in Neon Postgres (`model_inventory` table)
- Lets you filter by provider
- Supports full-text search across model JSON payloads
- Adds a serverless-only filter
- Shows selected model details in a right-side JSON panel
- Refreshes selected provider (or all providers) from live APIs and stores the latest model metadata
- Displays per-API-call timing and retrieved model counts for each refresh run

## Database setup (Neon on Vercel)

1. In Vercel, add a Neon database integration (or copy your Neon connection string).
2. Set one of these env vars in the Vercel project:
   - `NEON_DATABASE_URL` (preferred)
   - `POSTGRES_URL`
   - `DATABASE_URL`
3. Redeploy.

The app auto-creates table `model_inventory` and auto-seeds from local `results_*.json` when the DB is empty.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Build

```bash
npm run build
npm run start
```

## Deploy to Vercel

1. Push this repo to GitHub/GitLab/Bitbucket.
2. Import it in Vercel.
3. Deploy.

No environment variables are required for browsing cached model files.
