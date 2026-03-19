import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain, RefreshCw, ArrowUpRight, Shield, AlertTriangle, TrendingUp, Crosshair, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import type { MarketInsight, MispricingOpportunity } from "@shared/schema";

function SignalBadge({ signal }: { signal: MarketInsight["signal"] }) {
  const config = {
    strong_buy: { label: "Strong Buy", className: "bg-[hsl(var(--color-gain))]/15 text-[hsl(var(--color-gain))] border-[hsl(var(--color-gain))]/20" },
    buy: { label: "Buy", className: "bg-[hsl(var(--color-gain))]/10 text-[hsl(var(--color-gain))]/80 border-[hsl(var(--color-gain))]/15" },
    hold: { label: "Hold", className: "bg-muted text-muted-foreground border-border" },
    avoid: { label: "Avoid", className: "bg-destructive/10 text-destructive border-destructive/20" },
  };
  const c = config[signal];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${c.className}`}>
      {c.label}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${value * 100}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground w-8 text-right">
        {(value * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function InsightCard({ insight }: { insight: MarketInsight }) {
  return (
    <Card data-testid={`insight-${insight.id}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">
              {insight.eventTitle}
            </p>
            <p className="text-sm font-medium mt-0.5 leading-snug">
              {insight.marketQuestion}
            </p>
          </div>
          <SignalBadge signal={insight.signal} />
        </div>

        <div className="flex items-center gap-4">
          <div>
            <p className="text-[10px] text-muted-foreground">Probability</p>
            <p className="text-lg font-semibold tabular-nums">
              {(insight.currentProbability * 100).toFixed(0)}%
            </p>
          </div>
          <div className="flex-1">
            <p className="text-[10px] text-muted-foreground mb-1">Confidence</p>
            <ConfidenceBar value={insight.confidence} />
          </div>
        </div>

        <div className="text-xs text-muted-foreground leading-relaxed">
          {insight.reasoning}
        </div>

        {insight.factors.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {insight.factors.slice(0, 3).map((f, i) => (
              <Badge key={i} variant="secondary" className="text-[10px]">
                {f.length > 30 ? f.slice(0, 30) + "..." : f}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MispricingAlerts() {
  const { data: mispricings } = useQuery<MispricingOpportunity[]>({
    queryKey: ["/api/mispricings"],
    staleTime: 30_000,
  });

  const top3 = (mispricings || []).slice(0, 3);

  if (top3.length === 0) return null;

  return (
    <Card data-testid="mispricing-alerts-section">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-primary/10">
              <Crosshair className="w-3.5 h-3.5 text-primary" />
            </div>
            <h3 className="text-sm font-semibold">Mispricing Alerts</h3>
            <Badge variant="secondary" className="text-[10px]">
              {mispricings?.length || 0} total
            </Badge>
          </div>
          <Link href="/mispricing">
            <span
              className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1"
              data-testid="link-view-all-mispricings"
            >
              View All
              <ExternalLink className="w-3 h-3" />
            </span>
          </Link>
        </div>
        <div className="space-y-2">
          {top3.map((m) => (
            <div
              key={m.id}
              data-testid={`mispricing-alert-${m.id}`}
              className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/50 text-xs"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    m.type === "probability_sum"
                      ? "bg-primary/10 text-primary"
                      : "bg-[hsl(var(--chart-2))]/10 text-[hsl(var(--chart-2))]"
                  }`}
                >
                  {m.type === "probability_sum" ? "P-Sum" : "Binary"}
                </span>
                <a
                  href={m.polymarketUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground hover:text-primary transition-colors truncate"
                >
                  {m.eventTitle}
                </a>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span
                  className={`font-semibold tabular-nums ${
                    m.rawEdge >= 0.05
                      ? "text-[hsl(var(--color-gain))]"
                      : m.rawEdge >= 0.02
                        ? "text-[hsl(var(--chart-4))]"
                        : "text-muted-foreground"
                  }`}
                >
                  {(Number(m.rawEdge) * 100).toFixed(2)}%
                </span>
                <span className="text-muted-foreground tabular-nums">
                  Σ{Number(m.probabilitySum).toFixed(3)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Insights() {
  const { data: insights, isLoading } = useQuery<MarketInsight[]>({
    queryKey: ["/api/insights"],
    staleTime: 120_000,
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/insights/refresh");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/insights"] });
    },
  });

  const strongBuys = insights?.filter((i) => i.signal === "strong_buy") || [];
  const buys = insights?.filter((i) => i.signal === "buy") || [];
  const avoids = insights?.filter((i) => i.signal === "avoid") || [];

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            AI Insights
          </h2>
          <p className="text-sm text-muted-foreground">
            Automated analysis of market momentum, volume, and probability signals.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          data-testid="button-refresh-insights"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 mr-1.5 ${
              refreshMutation.isPending ? "animate-spin" : ""
            }`}
          />
          Refresh
        </Button>
      </div>

      {/* Mispricing Alerts */}
      <MispricingAlerts />

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-[hsl(var(--color-gain))]/10">
              <TrendingUp className="w-4 h-4 text-[hsl(var(--color-gain))]" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Strong Buys</p>
              <p className="text-lg font-semibold tabular-nums">{strongBuys.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10">
              <ArrowUpRight className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Buy Signals</p>
              <p className="text-lg font-semibold tabular-nums">{buys.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-destructive/10">
              <AlertTriangle className="w-4 h-4 text-destructive" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Avoid</p>
              <p className="text-lg font-semibold tabular-nums">{avoids.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-32 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <>
          {strongBuys.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Shield className="w-4 h-4 text-[hsl(var(--color-gain))]" />
                Strong Buy Opportunities
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {strongBuys.map((i) => (
                  <InsightCard key={i.id} insight={i} />
                ))}
              </div>
            </div>
          )}

          {buys.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <ArrowUpRight className="w-4 h-4 text-primary" />
                Buy Signals
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {buys.map((i) => (
                  <InsightCard key={i.id} insight={i} />
                ))}
              </div>
            </div>
          )}

          {avoids.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive" />
                Avoid
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {avoids.map((i) => (
                  <InsightCard key={i.id} insight={i} />
                ))}
              </div>
            </div>
          )}

          {(!insights || insights.length === 0) && (
            <div className="text-center py-12 text-muted-foreground">
              <Brain className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No insights yet. Click Refresh to analyze markets.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
