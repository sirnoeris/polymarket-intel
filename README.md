# PolyIntel — Polymarket AI Intelligence

A real-time Polymarket intelligence dashboard with AI-powered market analysis, watchlists, alerts, and daily reports.

## Features

- **Live Dashboard** — KPI cards, trending events, top movers updated every 2 minutes
- **AI Insights** — Automated analysis of market momentum, volume, and probability signals with buy/avoid ratings
- **Watchlist** — Track specific markets and events
- **Alerts** — Set probability and momentum thresholds
- **Daily Reports** — AI-generated market summaries

## Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS, shadcn/ui, TanStack Query
- **Backend**: Express.js (proxies Polymarket Gamma API with caching)
- **Data**: Polymarket Gamma API + CLOB API (public, no auth required)

## Local Development

```bash
npm install
npm run dev
```

Opens at `http://localhost:5000`.

## Production Build

```bash
npm run build
npm start
```

## Deploy to Railway (Free)

1. Fork this repo or connect your GitHub
2. Go to [railway.app](https://railway.app) and create a new project
3. Select "Deploy from GitHub repo" → pick `polymarket-intel`
4. Railway auto-detects the config — no environment variables needed
5. Click Deploy. Done.

Railway's free tier gives $5/month credit, which is more than enough for this app.

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/events/trending` | Top 50 events by 24h volume |
| `GET /api/markets/top-movers` | Markets with largest daily price changes |
| `GET /api/stats` | Aggregate market statistics |
| `GET /api/insights` | AI-generated market analysis |
| `POST /api/insights/refresh` | Refresh AI insights |
| `POST /api/reports/generate` | Generate daily report |
| `GET /api/reports/latest` | Latest daily report |
| `GET /api/watchlist` | User watchlist |
| `GET /api/alerts` | User alerts |

## License

MIT
