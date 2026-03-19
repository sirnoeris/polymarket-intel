import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertWatchlistItemSchema, insertAlertConfigSchema } from "@shared/schema";
import type { PolymarketEvent, PolymarketMarket, MarketInsight, DailyReport } from "@shared/schema";
import { randomUUID } from "crypto";

const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";

// Simple in-memory cache
const cache = new Map<string, { data: any; expiry: number }>();
function getCached(key: string): any | null {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiry) return entry.data;
  cache.delete(key);
  return null;
}
function setCache(key: string, data: any, ttlMs: number) {
  cache.set(key, { data, expiry: Date.now() + ttlMs });
}

async function fetchGamma(path: string, params: Record<string, string> = {}) {
  const url = new URL(path, GAMMA_API);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Gamma API error: ${res.status}`);
  return res.json();
}

async function fetchClob(path: string, params: Record<string, string> = {}) {
  const url = new URL(path, CLOB_API);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`CLOB API error: ${res.status}`);
  return res.json();
}

function parseOutcomes(market: PolymarketMarket) {
  try {
    const outcomes = JSON.parse(market.outcomes || "[]");
    const prices = JSON.parse(market.outcomePrices || "[]");
    return outcomes.map((o: string, i: number) => ({
      name: o,
      price: parseFloat(prices[i] || "0"),
    }));
  } catch {
    return [];
  }
}

function analyzeMarket(event: PolymarketEvent, market: PolymarketMarket): MarketInsight | null {
  const parsed = parseOutcomes(market);
  if (parsed.length === 0) return null;

  const yesPrice = parsed.find((p: any) => p.name === "Yes")?.price ??
    parsed[0]?.price ?? 0;

  const dayChange = market.oneDayPriceChange || 0;
  const weekChange = market.oneWeekPriceChange || 0;
  const vol24h = market.volume24hr || 0;

  // Score: combination of momentum, volume, and probability extremes
  let score = 0;
  let factors: string[] = [];
  let signal: "strong_buy" | "buy" | "hold" | "avoid" = "hold";

  // High momentum (price moving up recently)
  if (dayChange > 0.05) { score += 30; factors.push(`Strong +${(dayChange * 100).toFixed(1)}% daily move`); }
  else if (dayChange > 0.02) { score += 15; factors.push(`Positive ${(dayChange * 100).toFixed(1)}% daily momentum`); }
  else if (dayChange < -0.05) { score -= 20; factors.push(`Sharp ${(dayChange * 100).toFixed(1)}% daily decline`); }

  // Weekly trend confirmation
  if (weekChange > 0.1) { score += 20; factors.push(`Strong weekly uptrend +${(weekChange * 100).toFixed(1)}%`); }
  else if (weekChange < -0.1) { score -= 15; factors.push(`Weekly downtrend ${(weekChange * 100).toFixed(1)}%`); }

  // Value zone: high probability markets near resolution
  if (yesPrice > 0.8 && yesPrice < 0.95) { score += 15; factors.push("Near-resolution value zone (80-95%)"); }
  if (yesPrice > 0.3 && yesPrice < 0.7) { score += 10; factors.push("Competitive probability range"); }

  // Volume indicates interest
  if (vol24h > 100000) { score += 15; factors.push(`High 24h volume ($${(vol24h / 1000).toFixed(0)}k)`); }
  else if (vol24h > 10000) { score += 5; factors.push(`Active trading ($${(vol24h / 1000).toFixed(0)}k vol)`); }

  // Spread check
  if (market.spread && market.spread < 0.02) { score += 5; factors.push("Tight spread (good liquidity)"); }

  // Determine signal
  if (score >= 40) signal = "strong_buy";
  else if (score >= 20) signal = "buy";
  else if (score < -10) signal = "avoid";
  else signal = "hold";

  const confidence = Math.min(Math.max(Math.abs(score) / 60, 0.1), 0.95);

  const reasoning = factors.length > 0
    ? factors.join(". ") + "."
    : "Neutral market with no strong signals.";

  return {
    id: randomUUID(),
    eventId: event.id,
    eventTitle: event.title,
    marketId: market.id,
    marketQuestion: market.question,
    currentProbability: yesPrice,
    signal,
    confidence,
    reasoning,
    factors,
    timestamp: new Date().toISOString(),
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ── Market Data ──────────────────────────────────────────────
  app.get("/api/events/trending", async (_req, res) => {
    try {
      const cacheKey = "events_trending";
      let data = getCached(cacheKey);
      if (!data) {
        data = await fetchGamma("/events", {
          active: "true",
          closed: "false",
          limit: "50",
          order: "volume24hr",
          ascending: "false",
        });
        setCache(cacheKey, data, 60_000); // 1 min cache
      }
      res.json(data);
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  app.get("/api/events/search", async (req, res) => {
    try {
      const q = req.query.q as string || "";
      const data = await fetchGamma("/events", {
        active: "true",
        closed: "false",
        limit: "30",
        order: "volume24hr",
        ascending: "false",
        ...(q ? { tag: q } : {}),
      });
      res.json(data);
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  app.get("/api/events/:id", async (req, res) => {
    try {
      const data = await fetchGamma(`/events/${req.params.id}`);
      res.json(data);
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  app.get("/api/markets/top-movers", async (_req, res) => {
    try {
      const cacheKey = "top_movers";
      let data = getCached(cacheKey);
      if (!data) {
        const markets = await fetchGamma("/markets", {
          active: "true",
          closed: "false",
          limit: "100",
          order: "volume24hr",
          ascending: "false",
        });
        // Filter to markets with significant price changes
        data = (markets as PolymarketMarket[])
          .filter((m) => m.oneDayPriceChange != null && Math.abs(m.oneDayPriceChange) > 0.01)
          .sort((a, b) => Math.abs(b.oneDayPriceChange || 0) - Math.abs(a.oneDayPriceChange || 0))
          .slice(0, 20);
        setCache(cacheKey, data, 60_000);
      }
      res.json(data);
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  app.get("/api/markets/:id/history", async (req, res) => {
    try {
      const tokenId = req.query.tokenId as string;
      if (!tokenId) return res.status(400).json({ error: "tokenId required" });
      const interval = (req.query.interval as string) || "1d";
      const data = await fetchClob("/prices-history", {
        market: tokenId,
        interval,
      });
      res.json(data);
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  app.get("/api/tags", async (_req, res) => {
    try {
      const cacheKey = "tags";
      let data = getCached(cacheKey);
      if (!data) {
        data = await fetchGamma("/tags");
        setCache(cacheKey, data, 300_000); // 5 min cache
      }
      res.json(data);
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  // ── AI Insights Engine ───────────────────────────────────────
  app.get("/api/insights", async (_req, res) => {
    try {
      let insights = await storage.getInsights();
      if (insights.length === 0) {
        // Generate fresh insights
        const events = await fetchGamma("/events", {
          active: "true",
          closed: "false",
          limit: "30",
          order: "volume24hr",
          ascending: "false",
        }) as PolymarketEvent[];

        insights = [];
        for (const event of events) {
          if (!event.markets) continue;
          for (const market of event.markets) {
            if (market.closed) continue;
            const insight = analyzeMarket(event, market);
            if (insight && insight.signal !== "hold") {
              insights.push(insight);
            }
          }
        }
        // Sort by confidence and signal strength
        const signalOrder = { strong_buy: 0, buy: 1, hold: 2, avoid: 3 };
        insights.sort((a, b) => {
          const sigDiff = signalOrder[a.signal] - signalOrder[b.signal];
          if (sigDiff !== 0) return sigDiff;
          return b.confidence - a.confidence;
        });
        insights = insights.slice(0, 25);
        await storage.saveInsights(insights);
      }
      res.json(insights);
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  app.post("/api/insights/refresh", async (_req, res) => {
    try {
      const events = await fetchGamma("/events", {
        active: "true",
        closed: "false",
        limit: "30",
        order: "volume24hr",
        ascending: "false",
      }) as PolymarketEvent[];

      let insights: MarketInsight[] = [];
      for (const event of events) {
        if (!event.markets) continue;
        for (const market of event.markets) {
          if (market.closed) continue;
          const insight = analyzeMarket(event, market);
          if (insight && insight.signal !== "hold") {
            insights.push(insight);
          }
        }
      }
      const signalOrder = { strong_buy: 0, buy: 1, hold: 2, avoid: 3 };
      insights.sort((a, b) => {
        const sigDiff = signalOrder[a.signal] - signalOrder[b.signal];
        if (sigDiff !== 0) return sigDiff;
        return b.confidence - a.confidence;
      });
      insights = insights.slice(0, 25);
      await storage.saveInsights(insights);
      res.json(insights);
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  // ── Daily Report ─────────────────────────────────────────────
  app.get("/api/reports", async (_req, res) => {
    try {
      const reports = await storage.getReports();
      res.json(reports);
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  app.get("/api/reports/latest", async (_req, res) => {
    try {
      const report = await storage.getLatestReport();
      if (!report) {
        return res.status(404).json({ error: "No reports yet" });
      }
      res.json(report);
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  app.post("/api/reports/generate", async (_req, res) => {
    try {
      // Fetch fresh data
      const events = await fetchGamma("/events", {
        active: "true",
        closed: "false",
        limit: "50",
        order: "volume24hr",
        ascending: "false",
      }) as PolymarketEvent[];

      let allInsights: MarketInsight[] = [];
      let totalActive = 0;
      let highVolume = 0;
      let bigMovers = 0;

      for (const event of events) {
        if (!event.markets) continue;
        for (const market of event.markets) {
          if (market.closed) continue;
          totalActive++;
          if ((market.volume24hr || 0) > 50000) highVolume++;
          if (Math.abs(market.oneDayPriceChange || 0) > 0.05) bigMovers++;

          const insight = analyzeMarket(event, market);
          if (insight && (insight.signal === "strong_buy" || insight.signal === "buy")) {
            allInsights.push(insight);
          }
        }
      }

      const signalOrder = { strong_buy: 0, buy: 1, hold: 2, avoid: 3 };
      allInsights.sort((a, b) => {
        const sigDiff = signalOrder[a.signal] - signalOrder[b.signal];
        if (sigDiff !== 0) return sigDiff;
        return b.confidence - a.confidence;
      });

      const alerts = await storage.getAlerts();

      const report: DailyReport = {
        id: randomUUID(),
        date: new Date().toISOString().split("T")[0],
        generatedAt: new Date().toISOString(),
        topOpportunities: allInsights.slice(0, 10),
        marketSummary: { totalActive, highVolume, bigMovers },
        alertsSummary: {
          triggered: alerts.filter((a) => a.lastTriggered).length,
          pending: alerts.filter((a) => a.enabled && !a.lastTriggered).length,
        },
      };

      await storage.saveReport(report);
      res.json(report);
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  // ── Watchlist ────────────────────────────────────────────────
  app.get("/api/watchlist", async (_req, res) => {
    try {
      const items = await storage.getWatchlist();
      res.json(items);
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  app.post("/api/watchlist", async (req, res) => {
    try {
      const parsed = insertWatchlistItemSchema.parse(req.body);
      const item = await storage.addToWatchlist(parsed);
      res.status(201).json(item);
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  app.delete("/api/watchlist/:id", async (req, res) => {
    try {
      await storage.removeFromWatchlist(req.params.id);
      res.json({ deleted: true });
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  // ── Alerts ───────────────────────────────────────────────────
  app.get("/api/alerts", async (_req, res) => {
    try {
      const alerts = await storage.getAlerts();
      res.json(alerts);
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  app.post("/api/alerts", async (req, res) => {
    try {
      const parsed = insertAlertConfigSchema.parse(req.body);
      const alert = await storage.createAlert(parsed);
      res.status(201).json(alert);
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  app.patch("/api/alerts/:id", async (req, res) => {
    try {
      const updated = await storage.updateAlert(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  app.delete("/api/alerts/:id", async (req, res) => {
    try {
      await storage.deleteAlert(req.params.id);
      res.json({ deleted: true });
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  // ── Stats / Overview ─────────────────────────────────────────
  app.get("/api/stats", async (_req, res) => {
    try {
      const cacheKey = "stats";
      let data = getCached(cacheKey);
      if (!data) {
        const events = await fetchGamma("/events", {
          active: "true",
          closed: "false",
          limit: "100",
          order: "volume24hr",
          ascending: "false",
        }) as PolymarketEvent[];

        let totalVolume24h = 0;
        let totalLiquidity = 0;
        let totalMarkets = 0;
        let biggestMover = { question: "", change: 0 };

        for (const event of events) {
          totalVolume24h += event.volume24hr || 0;
          totalLiquidity += event.liquidity || 0;
          if (event.markets) {
            for (const m of event.markets) {
              if (!m.closed) totalMarkets++;
              const change = Math.abs(m.oneDayPriceChange || 0);
              if (change > Math.abs(biggestMover.change)) {
                biggestMover = { question: m.question, change: m.oneDayPriceChange || 0 };
              }
            }
          }
        }

        data = {
          totalVolume24h,
          totalLiquidity,
          totalMarkets,
          totalEvents: events.length,
          biggestMover,
        };
        setCache(cacheKey, data, 60_000);
      }
      res.json(data);
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  return httpServer;
}
