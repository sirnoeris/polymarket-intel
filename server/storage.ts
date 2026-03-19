import {
  type WatchlistItem,
  type AlertConfig,
  type MarketInsight,
  type DailyReport,
  type InsertWatchlistItem,
  type InsertAlertConfig,
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Watchlist
  getWatchlist(): Promise<WatchlistItem[]>;
  addToWatchlist(item: InsertWatchlistItem): Promise<WatchlistItem>;
  removeFromWatchlist(id: string): Promise<void>;

  // Alerts
  getAlerts(): Promise<AlertConfig[]>;
  createAlert(alert: InsertAlertConfig): Promise<AlertConfig>;
  updateAlert(id: string, updates: Partial<AlertConfig>): Promise<AlertConfig | undefined>;
  deleteAlert(id: string): Promise<void>;

  // Insights
  getInsights(): Promise<MarketInsight[]>;
  saveInsights(insights: MarketInsight[]): Promise<void>;

  // Reports
  getReports(): Promise<DailyReport[]>;
  getLatestReport(): Promise<DailyReport | undefined>;
  saveReport(report: DailyReport): Promise<void>;
}

export class MemStorage implements IStorage {
  private watchlist: Map<string, WatchlistItem> = new Map();
  private alerts: Map<string, AlertConfig> = new Map();
  private insights: MarketInsight[] = [];
  private reports: DailyReport[] = [];

  async getWatchlist(): Promise<WatchlistItem[]> {
    return Array.from(this.watchlist.values());
  }

  async addToWatchlist(item: InsertWatchlistItem): Promise<WatchlistItem> {
    const id = randomUUID();
    const watchlistItem: WatchlistItem = {
      ...item,
      id,
      addedAt: new Date().toISOString(),
    };
    this.watchlist.set(id, watchlistItem);
    return watchlistItem;
  }

  async removeFromWatchlist(id: string): Promise<void> {
    this.watchlist.delete(id);
  }

  async getAlerts(): Promise<AlertConfig[]> {
    return Array.from(this.alerts.values());
  }

  async createAlert(alert: InsertAlertConfig): Promise<AlertConfig> {
    const id = randomUUID();
    const alertConfig: AlertConfig = {
      ...alert,
      id,
      createdAt: new Date().toISOString(),
    };
    this.alerts.set(id, alertConfig);
    return alertConfig;
  }

  async updateAlert(id: string, updates: Partial<AlertConfig>): Promise<AlertConfig | undefined> {
    const existing = this.alerts.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.alerts.set(id, updated);
    return updated;
  }

  async deleteAlert(id: string): Promise<void> {
    this.alerts.delete(id);
  }

  async getInsights(): Promise<MarketInsight[]> {
    return this.insights;
  }

  async saveInsights(insights: MarketInsight[]): Promise<void> {
    this.insights = insights;
  }

  async getReports(): Promise<DailyReport[]> {
    return this.reports;
  }

  async getLatestReport(): Promise<DailyReport | undefined> {
    return this.reports.length > 0 ? this.reports[this.reports.length - 1] : undefined;
  }

  async saveReport(report: DailyReport): Promise<void> {
    this.reports.push(report);
    // Keep last 30 reports
    if (this.reports.length > 30) {
      this.reports = this.reports.slice(-30);
    }
  }
}

export const storage = new MemStorage();
