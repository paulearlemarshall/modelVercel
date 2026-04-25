# Model Browser (Next.js + Vercel)

This repo converts the original Python TUI model explorer into a web app that runs on Next.js and deploys cleanly on Vercel.

## What it does

- Loads provider cache files from `results_*.json`
- Lets you filter by provider
- Supports full-text search across model JSON payloads
- Adds a serverless-only filter
- Shows selected model details in a right-side JSON panel

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
