# Model Browser (Next.js + Vercel)

This repo converts the original Python TUI model explorer into a web app that runs on Next.js and deploys cleanly on Vercel.

## What it does

- Loads provider cache files from `results_*.json`
- Persists model data in Vercel Postgres/Neon (`model_inventory` table)
- Lets you filter by provider
- Supports full-text search across model JSON payloads
- Adds a serverless-only filter
- Shows selected model details in a right-side JSON panel
- Refreshes selected provider (or all providers) from live APIs and stores the latest model metadata
- Displays per-API-call timing and retrieved model counts for each refresh run

## Database setup (Vercel Storage)

1. In Vercel, add the Postgres/Neon storage integration to this project.
2. Ensure `POSTGRES_URL` exists in the Vercel project environment variables.
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

Required env vars:

- `POSTGRES_URL` for model storage
- provider API keys (for refresh actions): `OPENAI_API_KEY`, `NVIDIA_API_KEY`, `FIREWORKS_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, `ALIBABA_API_KEY`, `MOONSHOT_API_KEY`, `OPENROUTER_API_KEY`
