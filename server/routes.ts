import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertWatchlistItemSchema, insertAlertConfigSchema } from "@shared/schema";
import type { PolymarketEvent, PolymarketMarket, MarketInsight, DailyReport, MispricingOpportunity, MispricingStats } from "@shared/schema";
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

function parseClobTokenIds(market: PolymarketMarket): string[] {
  try {
    return JSON.parse(market.clobTokenIds || "[]");
  } catch {
    return [];
  }
}

async function batchFetchMidpoints(tokenIds: string[]): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  if (tokenIds.length === 0) return results;

  // Batch in chunks of 100 to avoid overloading
  const chunks: string[][] = [];
  for (let i = 0; i < tokenIds.length; i += 100) {
    chunks.push(tokenIds.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    try {
      const body = chunk.map((token_id) => ({ token_id }));
      const res = await fetch(`${CLOB_API}/midpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        // Response is Record<tokenId, midpoint string>
        for (const [tokenId, mid] of Object.entries(data)) {
          results[tokenId] = parseFloat(mid as string) || 0;
        }
      }
    } catch {
      // Continue with what we have
    }
  }
  return results;
}

async function batchFetchSpreads(tokenIds: string[]): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  if (tokenIds.length === 0) return results;

  const chunks: string[][] = [];
  for (let i = 0; i < tokenIds.length; i += 100) {
    chunks.push(tokenIds.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    try {
      const body = chunk.map((token_id) => ({ token_id }));
      const res = await fetch(`${CLOB_API}/spreads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        for (const [tokenId, spread] of Object.entries(data)) {
          results[tokenId] = parseFloat(spread as string) || 0;
        }
      }
    } catch {
      // Continue
    }
  }
  return results;
}

async function fetchOrderbookDepth(tokenId: string): Promise<{ slippage100: number; slippage500: number }> {
  try {
    const data = await fetchClob("/book", { token_id: tokenId });
    const asks = (data.asks || []) as Array<{ price: string; size: string }>;
    
    function calcSlippage(targetAmount: number): number {
      let remaining = targetAmount;
      let totalCost = 0;
      for (const level of asks) {
        const price = parseFloat(level.price);
        const size = parseFloat(level.size);
        const levelValue = price * size;
        if (remaining <= levelValue) {
          totalCost += remaining;
          remaining = 0;
          break;
        }
        totalCost += levelValue;
        remaining -= levelValue;
      }
      if (remaining > 0) return 0.1; // Not enough depth
      const avgPrice = totalCost / targetAmount;
      const midPrice = asks.length > 0 ? parseFloat(asks[0].price) : avgPrice;
      return Math.max(0, avgPrice - midPrice);
    }

    return {
      slippage100: calcSlippage(100),
      slippage500: calcSlippage(500),
    };
  } catch {
    return { slippage100: 0, slippage500: 0 };
  }
}

function getTimeUrgency(endDate?: string): { urgency: "critical" | "high" | "medium" | "low"; hoursToExpiry?: number } {
  if (!endDate) return { urgency: "low" };
  const now = Date.now();
  const end = new Date(endDate).getTime();
  const hoursToExpiry = Math.max(0, (end - now) / (1000 * 60 * 60));
  
  if (hoursToExpiry <= 24) return { urgency: "critical", hoursToExpiry };
  if (hoursToExpiry <= 72) return { urgency: "high", hoursToExpiry };
  if (hoursToExpiry <= 168) return { urgency: "medium", hoursToExpiry };
  return { urgency: "low", hoursToExpiry };
}

/**
 * Classify whether a multi-market event has mutually exclusive outcomes.
 * Mutually exclusive = exactly one outcome wins (e.g. "Who wins the election?").
 * NOT mutually exclusive = independent markets grouped under one event
 * (e.g. player props, bracketed thresholds like "BTC above 60k/62k/64k").
 *
 * Heuristics:
 * 1. If all markets are binary Yes/No and their Yes prices roughly sum to ~1.0 (0.7–1.5),
 *    they're likely mutually exclusive options.
 * 2. If outcomes have ascending numeric patterns (thresholds), they're cumulative — NOT exclusive.
 * 3. If outcomes contain independent player/stat markets, they're NOT exclusive.
 * 4. If probabilities sum to >2.0 or <0.3, they're clearly NOT exclusive outcomes.
 */
function classifyEventOutcomes(markets: PolymarketMarket[]): "mutually_exclusive" | "independent" | "cumulative" {
  if (markets.length < 2) return "independent";

  // Get Yes prices for all markets
  const yesPrices: number[] = [];
  const names: string[] = [];
  for (const m of markets) {
    const parsed = parseOutcomes(m);
    const yesP = parsed.find((p: any) => p.name === "Yes")?.price ?? parsed[0]?.price ?? 0;
    yesPrices.push(yesP);
    names.push(m.groupItemTitle || m.question || "");
  }

  // Check for cumulative/threshold patterns ("above 60k", "above 62k", etc.)
  // These have descending probabilities (higher threshold = lower probability)
  const numericPattern = /(?:above|over|under|below|more than|less than|at least|\d+[\.,]?\d*)/i;
  const hasNumericPattern = names.filter(n => numericPattern.test(n)).length > markets.length * 0.5;
  if (hasNumericPattern) {
    // Check if prices are monotonically decreasing/increasing (cumulative distribution)
    let monotoneDecreasing = true;
    let monotoneIncreasing = true;
    for (let i = 1; i < yesPrices.length; i++) {
      if (yesPrices[i] > yesPrices[i - 1] + 0.05) monotoneDecreasing = false;
      if (yesPrices[i] < yesPrices[i - 1] - 0.05) monotoneIncreasing = false;
    }
    if (monotoneDecreasing || monotoneIncreasing) return "cumulative";
  }

  // Check for independent player props ("Player: Stat O/U X.5" patterns)
  const playerPropPattern = /(?:O\/U|over\/under|points|rebounds|assists|goals|saves|strikeouts|tackles|yards|completions|interceptions)/i;
  const playerPropCount = names.filter(n => playerPropPattern.test(n)).length;
  if (playerPropCount > markets.length * 0.3) return "independent";

  // Check for half/quarter/period sub-markets mixed with player props
  const periodPattern = /(?:1H|2H|1Q|2Q|3Q|4Q|half|quarter|period|spread|total|O\/U)/i;
  const periodCount = names.filter(n => periodPattern.test(n)).length;
  if (periodCount > markets.length * 0.3 && markets.length > 5) return "independent";

  // Sum check: mutually exclusive outcomes should sum to roughly 1.0
  const probSum = yesPrices.reduce((s, p) => s + p, 0);

  // If sum is wildly off (>2.0 or <0.3), these aren't exclusive
  if (probSum > 2.0 || probSum < 0.3) return "independent";

  // Reasonable range for mutually exclusive outcomes (0.7 to 1.5)
  if (probSum >= 0.7 && probSum <= 1.5) return "mutually_exclusive";

  return "independent";
}

async function detectMispricings(events: PolymarketEvent[]): Promise<MispricingOpportunity[]> {
  // Collect all token IDs across all markets
  const allTokenIds: string[] = [];
  const tokenToMarketEvent: Map<string, { market: PolymarketMarket; event: PolymarketEvent; index: number }> = new Map();

  for (const event of events) {
    if (!event.markets) continue;
    for (const market of event.markets) {
      if (market.closed) continue;
      const tokenIds = parseClobTokenIds(market);
      tokenIds.forEach((tid, idx) => {
        allTokenIds.push(tid);
        tokenToMarketEvent.set(tid, { market, event, index: idx });
      });
    }
  }

  // Batch fetch midpoints and spreads
  const [midpoints, spreads] = await Promise.all([
    batchFetchMidpoints(allTokenIds),
    batchFetchSpreads(allTokenIds),
  ]);

  const opportunities: MispricingOpportunity[] = [];

  // Analyze each event for mispricings
  for (const event of events) {
    if (!event.markets) continue;

    const eventMarkets = event.markets.filter((m) => !m.closed);
    if (eventMarkets.length === 0) continue;

    if (eventMarkets.length > 1) {
      // Multi-market event — classify the outcome structure first
      const classification = classifyEventOutcomes(eventMarkets);

      if (classification === "mutually_exclusive") {
        // PROBABILITY SUM DEVIATION — only valid for mutually exclusive outcomes
        let probSum = 0;
        let totalSpreadCost = 0;
        const outcomeDetails: MispricingOpportunity["outcomes"] = [];
        let totalLiquidity = 0;
        let totalVolume24h = 0;
        let hasData = false;

        for (const market of eventMarkets) {
          const tokenIds = parseClobTokenIds(market);
          const yesTokenId = tokenIds[0];
          if (!yesTokenId) continue;

          const mid = midpoints[yesTokenId];
          const spread = spreads[yesTokenId] || market.spread || 0;

          if (mid !== undefined && mid > 0) {
            hasData = true;
            probSum += mid;
            totalSpreadCost += spread;
            totalLiquidity += parseFloat(String(market.liquidity || 0)) || 0;
            totalVolume24h += parseFloat(String(market.volume24hr || 0)) || 0;

            outcomeDetails.push({
              name: market.groupItemTitle || market.question,
              midPrice: mid,
              bestBid: Math.max(0, mid - spread / 2),
              bestAsk: Math.min(1, mid + spread / 2),
              spread,
              tokenId: yesTokenId,
            });
          }
        }

        if (!hasData || outcomeDetails.length < 2) continue;

        const rawEdge = Math.abs(1.0 - probSum);
        const effectiveEdge = Math.max(0, rawEdge - totalSpreadCost);

        if (rawEdge >= 0.01) {
          const { urgency, hoursToExpiry } = getTimeUrgency(event.endDate);
          const timeWeight = urgency === "critical" ? 2.0 : urgency === "high" ? 1.5 : urgency === "medium" ? 1.2 : 1.0;
          const volumeFactor = totalVolume24h > 0 ? Math.min(1.5, 0.5 + Math.log10(totalVolume24h) / 10) : 0.5;
          const liquidityScore = totalLiquidity > 0 ? Math.log(totalLiquidity) : 0;
          const score = effectiveEdge * liquidityScore * volumeFactor * timeWeight * 1000;

          opportunities.push({
            id: randomUUID(),
            eventId: event.id,
            eventTitle: event.title,
            eventSlug: event.slug,
            type: "probability_sum",
            rawEdge,
            effectiveEdge,
            spreadCost: totalSpreadCost,
            probabilitySum: probSum,
            outcomes: outcomeDetails,
            score,
            liquidity: totalLiquidity,
            volume24h: totalVolume24h,
            endDate: event.endDate,
            hoursToExpiry,
            timeUrgency: urgency,
            estimatedSlippage100: 0,
            estimatedSlippage500: 0,
            detectedAt: new Date().toISOString(),
            polymarketUrl: `https://polymarket.com/event/${event.slug || event.id}`,
          });
        }
      } else {
        // Independent or cumulative markets — check each binary market individually
        for (const market of eventMarkets) {
          const tokenIds = parseClobTokenIds(market);
          if (tokenIds.length < 2) continue;

          const yesMid = midpoints[tokenIds[0]];
          const noMid = midpoints[tokenIds[1]];
          const yesSpread = spreads[tokenIds[0]] || market.spread || 0;
          const noSpread = spreads[tokenIds[1]] || market.spread || 0;

          if (yesMid === undefined || noMid === undefined) continue;
          if (yesMid <= 0 && noMid <= 0) continue;

          const probSum = yesMid + noMid;
          const rawEdge = Math.abs(1.0 - probSum);
          const totalSpread = yesSpread + noSpread;
          const effectiveEdge = Math.max(0, rawEdge - totalSpread);

          // Higher threshold for individual binary markets (2% min) to reduce noise
          if (rawEdge >= 0.02 && effectiveEdge > 0) {
            const liq = parseFloat(String(market.liquidity || 0)) || 0;
            const vol = parseFloat(String(market.volume24hr || 0)) || 0;
            // Skip very low liquidity markets (likely stale/illiquid)
            if (liq < 500 && vol < 1000) continue;

            const { urgency, hoursToExpiry } = getTimeUrgency(market.endDate || event.endDate);
            const timeWeight = urgency === "critical" ? 2.0 : urgency === "high" ? 1.5 : urgency === "medium" ? 1.2 : 1.0;
            const volumeFactor = vol > 0 ? Math.min(1.5, 0.5 + Math.log10(vol) / 10) : 0.5;
            const liquidityScore = liq > 0 ? Math.log(liq) : 0;
            const score = effectiveEdge * liquidityScore * volumeFactor * timeWeight * 1000;

            opportunities.push({
              id: randomUUID(),
              eventId: event.id,
              eventTitle: event.title + " — " + (market.groupItemTitle || market.question),
              eventSlug: event.slug,
              type: "binary_deviation",
              rawEdge,
              effectiveEdge,
              spreadCost: totalSpread,
              probabilitySum: probSum,
              outcomes: [
                {
                  name: "Yes",
                  midPrice: yesMid,
                  bestBid: Math.max(0, yesMid - yesSpread / 2),
                  bestAsk: Math.min(1, yesMid + yesSpread / 2),
                  spread: yesSpread,
                  tokenId: tokenIds[0],
                },
                {
                  name: "No",
                  midPrice: noMid,
                  bestBid: Math.max(0, noMid - noSpread / 2),
                  bestAsk: Math.min(1, noMid + noSpread / 2),
                  spread: noSpread,
                  tokenId: tokenIds[1],
                },
              ],
              score,
              liquidity: liq,
              volume24h: vol,
              endDate: market.endDate || event.endDate,
              hoursToExpiry,
              timeUrgency: urgency,
              estimatedSlippage100: 0,
              estimatedSlippage500: 0,
              detectedAt: new Date().toISOString(),
              polymarketUrl: `https://polymarket.com/event/${event.slug || event.id}`,
            });
          }
        }
      }
    } else {
      // Single binary market under the event
      const market = eventMarkets[0];
      const tokenIds = parseClobTokenIds(market);
      if (tokenIds.length < 2) continue;

      const yesMid = midpoints[tokenIds[0]];
      const noMid = midpoints[tokenIds[1]];
      const yesSpread = spreads[tokenIds[0]] || market.spread || 0;
      const noSpread = spreads[tokenIds[1]] || market.spread || 0;

      if (yesMid === undefined || noMid === undefined) continue;
      if (yesMid <= 0 && noMid <= 0) continue;

      const probSum = yesMid + noMid;
      const rawEdge = Math.abs(1.0 - probSum);
      const totalSpread = yesSpread + noSpread;
      const effectiveEdge = Math.max(0, rawEdge - totalSpread);

      if (rawEdge >= 0.02 && effectiveEdge > 0) {
        const liq = parseFloat(String(market.liquidity || 0)) || 0;
        const vol = parseFloat(String(market.volume24hr || 0)) || 0;
        if (liq < 500 && vol < 1000) continue;

        const { urgency, hoursToExpiry } = getTimeUrgency(market.endDate || event.endDate);
        const timeWeight = urgency === "critical" ? 2.0 : urgency === "high" ? 1.5 : urgency === "medium" ? 1.2 : 1.0;
        const volumeFactor = vol > 0 ? Math.min(1.5, 0.5 + Math.log10(vol) / 10) : 0.5;
        const liquidityScore = liq > 0 ? Math.log(liq) : 0;
        const score = effectiveEdge * liquidityScore * volumeFactor * timeWeight * 1000;

        opportunities.push({
          id: randomUUID(),
          eventId: event.id,
          eventTitle: event.title,
          eventSlug: event.slug,
          type: "binary_deviation",
          rawEdge,
          effectiveEdge,
          spreadCost: totalSpread,
          probabilitySum: probSum,
          outcomes: [
            {
              name: "Yes",
              midPrice: yesMid,
              bestBid: Math.max(0, yesMid - yesSpread / 2),
              bestAsk: Math.min(1, yesMid + yesSpread / 2),
              spread: yesSpread,
              tokenId: tokenIds[0],
            },
            {
              name: "No",
              midPrice: noMid,
              bestBid: Math.max(0, noMid - noSpread / 2),
              bestAsk: Math.min(1, noMid + noSpread / 2),
              spread: noSpread,
              tokenId: tokenIds[1],
            },
          ],
          score,
          liquidity: liq,
          volume24h: vol,
          endDate: market.endDate || event.endDate,
          hoursToExpiry,
          timeUrgency: urgency,
          estimatedSlippage100: 0,
          estimatedSlippage500: 0,
          detectedAt: new Date().toISOString(),
          polymarketUrl: `https://polymarket.com/event/${event.slug || event.id}`,
        });
      }
    }
  }

  // Sort by score descending
  opportunities.sort((a, b) => b.score - a.score);

  // Fetch orderbook depth for top 5
  const topN = opportunities.slice(0, 5);
  for (const opp of topN) {
    if (opp.outcomes.length > 0) {
      const { slippage100, slippage500 } = await fetchOrderbookDepth(opp.outcomes[0].tokenId);
      opp.estimatedSlippage100 = slippage100;
      opp.estimatedSlippage500 = slippage500;
    }
  }

  return opportunities;
}

function analyzeMarket(event: PolymarketEvent, market: PolymarketMarket): MarketInsight | null {
  const parsed = parseOutcomes(market);
  if (parsed.length === 0) return null;

  const yesOutcome = parsed.find((p: any) => p.name === "Yes");
  const noOutcome = parsed.find((p: any) => p.name === "No");
  const yesPrice = yesOutcome?.price ?? parsed[0]?.price ?? 0;
  const noPrice = noOutcome?.price ?? (1 - yesPrice);

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

  // Payout calculations
  const payoutMultiplier = yesPrice > 0 ? 1 / yesPrice : 0;
  const roiPercent = yesPrice > 0 ? ((1 - yesPrice) / yesPrice) * 100 : 0;

  return {
    id: randomUUID(),
    eventId: event.id,
    eventTitle: event.title,
    eventSlug: event.slug,
    marketId: market.id,
    marketQuestion: market.question,
    currentProbability: yesPrice,
    signal,
    confidence,
    reasoning,
    factors,
    timestamp: new Date().toISOString(),
    yesPrice,
    noPrice,
    payoutMultiplier: Math.round(payoutMultiplier * 100) / 100,
    roiPercent: Math.round(roiPercent),
    impliedProb: yesPrice,
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

  // ── Mispricing Detection ────────────────────────────────────
  app.get("/api/mispricings", async (_req, res) => {
    try {
      const cacheKey = "mispricings";
      let data = getCached(cacheKey);
      if (!data) {
        const events = await fetchGamma("/events", {
          active: "true",
          closed: "false",
          limit: "100",
          order: "volume24hr",
          ascending: "false",
        }) as PolymarketEvent[];

        data = await detectMispricings(events);
        await storage.saveMispricings(data);
        setCache(cacheKey, data, 30_000); // 30s cache
      }
      res.json(data);
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  app.post("/api/mispricings/refresh", async (_req, res) => {
    try {
      cache.delete("mispricings"); // Force bust cache
      const events = await fetchGamma("/events", {
        active: "true",
        closed: "false",
        limit: "100",
        order: "volume24hr",
        ascending: "false",
      }) as PolymarketEvent[];

      const data = await detectMispricings(events);
      await storage.saveMispricings(data);
      setCache("mispricings", data, 30_000);
      res.json(data);
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  });

  app.get("/api/mispricings/stats", async (_req, res) => {
    try {
      // Try cache first, then storage, then trigger a fresh scan
      let mispricings = getCached("mispricings") as MispricingOpportunity[] | null;
      if (!mispricings || mispricings.length === 0) {
        mispricings = await storage.getMispricings();
      }
      if (!mispricings || mispricings.length === 0) {
        // Trigger a scan so stats are populated on first load
        const events = await fetchGamma("/events", {
          active: "true",
          closed: "false",
          limit: "100",
          order: "volume24hr",
          ascending: "false",
        }) as PolymarketEvent[];
        mispricings = await detectMispricings(events);
        await storage.saveMispricings(mispricings);
        setCache("mispricings", mispricings, 30_000);
      }

      const stats: MispricingStats = {
        totalMispricings: mispricings.length,
        averageEdge: mispricings.length > 0
          ? mispricings.reduce((sum, m) => sum + m.rawEdge, 0) / mispricings.length
          : 0,
        bestEdge: mispricings.length > 0
          ? Math.max(...mispricings.map((m) => m.rawEdge))
          : 0,
        totalExploitableVolume: mispricings.reduce((sum, m) => sum + m.volume24h, 0),
        marketsScanned: mispricings.reduce((sum, m) => sum + m.outcomes.length, 0),
      };
      res.json(stats);
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
