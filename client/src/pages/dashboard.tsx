import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart3,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Crosshair,
} from "lucide-react";
import type { PolymarketEvent, PolymarketMarket, MispricingStats } from "@shared/schema";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function PriceChange({ change }: { change: number | undefined }) {
  if (change == null || change === 0)
    return (
      <span className="text-muted-foreground flex items-center gap-0.5 tabular-nums">
        <Minus className="w-3 h-3" /> 0%
      </span>
    );
  const isUp = change > 0;
  return (
    <span
      className={`flex items-center gap-0.5 tabular-nums ${
        isUp ? "text-[hsl(var(--color-gain))]" : "text-destructive"
      }`}
    >
      {isUp ? (
        <ArrowUpRight className="w-3 h-3" />
      ) : (
        <ArrowDownRight className="w-3 h-3" />
      )}
      {isUp ? "+" : ""}
      {(change * 100).toFixed(1)}%
    </span>
  );
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

function KPICard({
  label,
  value,
  icon: Icon,
  delta,
}: {
  label: string;
  value: string;
  icon: any;
  delta?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-semibold tabular-nums">{value}</p>
            {delta && (
              <p className="text-xs text-muted-foreground">{delta}</p>
            )}
          </div>
          <div className="p-2 rounded-md bg-primary/10">
            <Icon className="w-4 h-4 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EventRow({ event }: { event: PolymarketEvent }) {
  const topMarkets = (event.markets || [])
    .filter((m) => !m.closed && m.outcomePrices)
    .slice(0, 3);

  return (
    <div
      data-testid={`event-row-${event.id}`}
      className="py-3 px-4 border-b border-border last:border-0 hover:bg-accent/50 transition-colors"
    >
      <div className="flex items-start gap-3">
        {event.icon && (
          <img
            src={event.icon}
            alt=""
            className="w-8 h-8 rounded-md object-cover shrink-0 mt-0.5"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <a
              href={`https://polymarket.com/event/${event.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate"
            >
              {event.title}
            </a>
            {event.competitive && event.competitive > 0.8 && (
              <Badge variant="secondary" className="text-[10px] shrink-0">
                Competitive
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="tabular-nums">
              Vol 24h: {formatNumber(event.volume24hr || 0)}
            </span>
            <span className="tabular-nums">
              Liq: {formatNumber(event.liquidity || 0)}
            </span>
            <span>{event.markets?.length || 0} markets</span>
          </div>
          {topMarkets.length > 0 && (
            <div className="mt-2 space-y-1">
              {topMarkets.map((m) => {
                const parsed = parseOutcomes(m);
                const topOutcome = parsed.sort(
                  (a: any, b: any) => b.price - a.price
                )[0];
                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="text-muted-foreground truncate max-w-[280px]">
                      {m.groupItemTitle || m.question}
                    </span>
                    <div className="flex items-center gap-3">
                      {topOutcome && (
                        <span className="tabular-nums font-medium">
                          {topOutcome.name}:{" "}
                          {(topOutcome.price * 100).toFixed(0)}%
                        </span>
                      )}
                      <PriceChange change={m.oneDayPriceChange} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TopMoversPanel() {
  const { data: movers, isLoading } = useQuery<PolymarketMarket[]>({
    queryKey: ["/api/markets/top-movers"],
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          Top Movers (24h)
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : (
          <div className="max-h-[400px] overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
            {movers?.slice(0, 12).map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between py-2 px-4 text-xs border-b border-border last:border-0"
              >
                <span className="truncate max-w-[200px] text-foreground">
                  {m.question}
                </span>
                <PriceChange change={m.oneDayPriceChange} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: events, isLoading: eventsLoading } = useQuery<
    PolymarketEvent[]
  >({
    queryKey: ["/api/events/trending"],
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const { data: stats, isLoading: statsLoading } = useQuery<{
    totalVolume24h: number;
    totalLiquidity: number;
    totalMarkets: number;
    totalEvents: number;
    biggestMover: { question: string; change: number };
  }>({
    queryKey: ["/api/stats"],
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const { data: mispricingStats } = useQuery<MispricingStats>({
    queryKey: ["/api/mispricings/stats"],
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Dashboard</h2>
        <p className="text-sm text-muted-foreground">
          Live Polymarket intelligence. Updated every 2 minutes.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {statsLoading ? (
          [...Array(5)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <KPICard
              label="24h Volume"
              value={formatNumber(stats?.totalVolume24h || 0)}
              icon={DollarSign}
              delta="Across all markets"
            />
            <KPICard
              label="Total Liquidity"
              value={formatNumber(stats?.totalLiquidity || 0)}
              icon={BarChart3}
            />
            <KPICard
              label="Active Markets"
              value={String(stats?.totalMarkets || 0)}
              icon={TrendingUp}
              delta={`${stats?.totalEvents || 0} events`}
            />
            <KPICard
              label="Biggest Mover"
              value={
                stats?.biggestMover
                  ? `${stats.biggestMover.change > 0 ? "+" : ""}${(
                      stats.biggestMover.change * 100
                    ).toFixed(1)}%`
                  : "–"
              }
              icon={stats?.biggestMover?.change && stats.biggestMover.change > 0 ? TrendingUp : TrendingDown}
              delta={
                stats?.biggestMover?.question
                  ? stats.biggestMover.question.slice(0, 28) + "..."
                  : undefined
              }
            />
            <KPICard
              label="Active Mispricings"
              value={String(mispricingStats?.totalMispricings || 0)}
              icon={Crosshair}
              delta={
                mispricingStats?.bestEdge
                  ? `Best edge ≈ ${(Number(mispricingStats.bestEdge) * 100).toFixed(1)}%`
                  : "Scan to detect"
              }
            />
          </>
        )}
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trending Events */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                Trending Events
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {eventsLoading ? (
                <div className="p-4 space-y-3">
                  {[...Array(8)].map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : (
                <div
                  className="max-h-[600px] overflow-y-auto"
                  style={{ overscrollBehavior: "contain" }}
                >
                  {events
                    ?.filter((e) => (e.volume24hr || 0) > 1000)
                    .slice(0, 20)
                    .map((event) => (
                      <EventRow key={event.id} event={event} />
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Side Panel */}
        <div className="space-y-6">
          <TopMoversPanel />
        </div>
      </div>
    </div>
  );
}
