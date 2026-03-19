import { z } from "zod";

// ── Polymarket API Types ────────────────────────────────────────
export const polymarketMarketSchema = z.object({
  id: z.string(),
  question: z.string(),
  slug: z.string().optional(),
  outcomes: z.string().optional(),
  outcomePrices: z.string().optional(),
  volume: z.string().optional(),
  volume24hr: z.number().optional(),
  volume1wk: z.number().optional(),
  volume1mo: z.number().optional(),
  liquidity: z.number().optional(),
  active: z.boolean().optional(),
  closed: z.boolean().optional(),
  oneDayPriceChange: z.number().optional(),
  oneWeekPriceChange: z.number().optional(),
  oneMonthPriceChange: z.number().optional(),
  spread: z.number().optional(),
  clobTokenIds: z.string().optional(),
  endDate: z.string().optional(),
  image: z.string().optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
  conditionId: z.string().optional(),
  groupItemTitle: z.string().optional(),
});

export const polymarketEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string().optional(),
  description: z.string().optional(),
  image: z.string().optional(),
  icon: z.string().optional(),
  active: z.boolean().optional(),
  closed: z.boolean().optional(),
  liquidity: z.number().optional(),
  volume: z.number().optional(),
  volume24hr: z.number().optional(),
  volume1wk: z.number().optional(),
  volume1mo: z.number().optional(),
  competitive: z.number().optional(),
  commentCount: z.number().optional(),
  markets: z.array(polymarketMarketSchema).optional(),
  endDate: z.string().optional(),
});

export type PolymarketMarket = z.infer<typeof polymarketMarketSchema>;
export type PolymarketEvent = z.infer<typeof polymarketEventSchema>;

// ── App Domain Types ────────────────────────────────────────────
export interface WatchlistItem {
  id: string;
  eventId: string;
  eventTitle: string;
  marketId: string;
  marketQuestion: string;
  addedAt: string;
  notes?: string;
}

export interface AlertConfig {
  id: string;
  marketId: string;
  marketQuestion: string;
  eventTitle: string;
  type: "probability_above" | "probability_below" | "momentum_shift";
  threshold: number;
  enabled: boolean;
  lastTriggered?: string;
  createdAt: string;
}

export interface MarketInsight {
  id: string;
  eventId: string;
  eventTitle: string;
  eventSlug?: string;
  marketId: string;
  marketQuestion: string;
  currentProbability: number;
  signal: "strong_buy" | "buy" | "hold" | "avoid";
  confidence: number;
  reasoning: string;
  factors: string[];
  timestamp: string;
}

export interface DailyReport {
  id: string;
  date: string;
  generatedAt: string;
  topOpportunities: MarketInsight[];
  marketSummary: {
    totalActive: number;
    highVolume: number;
    bigMovers: number;
  };
  alertsSummary: {
    triggered: number;
    pending: number;
  };
}

// ── Insert schemas ──────────────────────────────────────────────
export const insertWatchlistItemSchema = z.object({
  eventId: z.string(),
  eventTitle: z.string(),
  marketId: z.string(),
  marketQuestion: z.string(),
  notes: z.string().optional(),
});

export const insertAlertConfigSchema = z.object({
  marketId: z.string(),
  marketQuestion: z.string(),
  eventTitle: z.string(),
  type: z.enum(["probability_above", "probability_below", "momentum_shift"]),
  threshold: z.number().min(0).max(1),
  enabled: z.boolean().default(true),
});

export type InsertWatchlistItem = z.infer<typeof insertWatchlistItemSchema>;
export type InsertAlertConfig = z.infer<typeof insertAlertConfigSchema>;

// ── Mispricing Detection Types ──────────────────────────────────
export interface MispricingOutcome {
  name: string;
  midPrice: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  tokenId: string;
}

export interface MispricingOpportunity {
  id: string;
  eventId: string;
  eventTitle: string;
  eventSlug?: string;
  type: "probability_sum" | "binary_deviation" | "spread_arb";

  // Core metrics
  rawEdge: number;
  effectiveEdge: number;
  spreadCost: number;
  probabilitySum: number;

  // Market details
  outcomes: MispricingOutcome[];

  // Scoring
  score: number;
  liquidity: number;
  volume24h: number;

  // Time
  endDate?: string;
  hoursToExpiry?: number;
  timeUrgency: "critical" | "high" | "medium" | "low";

  // Execution estimate
  estimatedSlippage100: number;
  estimatedSlippage500: number;

  // Meta
  detectedAt: string;
  polymarketUrl: string;
}

export interface MispricingStats {
  totalMispricings: number;
  averageEdge: number;
  bestEdge: number;
  totalExploitableVolume: number;
  marketsScanned: number;
}
