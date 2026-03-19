import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Crosshair,
  RefreshCw,
  Target,
  TrendingUp,
  Clock,
  DollarSign,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";
import type { MispricingOpportunity, MispricingStats } from "@shared/schema";

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatNumber(n: number): string {
  const v = toNum(n);
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function formatEdge(edge: number): string {
  return `${(toNum(edge) * 100).toFixed(2)}%`;
}

function TypeBadge({ type }: { type: MispricingOpportunity["type"] }) {
  const config = {
    probability_sum: {
      label: "Prob Sum",
      className:
        "bg-primary/10 text-primary border-primary/20",
    },
    binary_deviation: {
      label: "Binary",
      className:
        "bg-[hsl(var(--chart-2))]/10 text-[hsl(var(--chart-2))] border-[hsl(var(--chart-2))]/20",
    },
    spread_arb: {
      label: "Spread Arb",
      className:
        "bg-[hsl(var(--chart-4))]/10 text-[hsl(var(--chart-4))] border-[hsl(var(--chart-4))]/20",
    },
  };
  const c = config[type];
  return (
    <span
      data-testid={`badge-type-${type}`}
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${c.className}`}
    >
      {c.label}
    </span>
  );
}

function UrgencyBadge({
  urgency,
}: {
  urgency: MispricingOpportunity["timeUrgency"];
}) {
  const config = {
    critical: {
      label: "Critical",
      className: "bg-destructive/15 text-destructive border-destructive/20",
    },
    high: {
      label: "High",
      className:
        "bg-[hsl(var(--chart-4))]/15 text-[hsl(var(--chart-4))] border-[hsl(var(--chart-4))]/20",
    },
    medium: {
      label: "Medium",
      className:
        "bg-[hsl(var(--chart-2))]/10 text-[hsl(var(--chart-2))] border-[hsl(var(--chart-2))]/20",
    },
    low: {
      label: "Low",
      className: "bg-muted text-muted-foreground border-border",
    },
  };
  const c = config[urgency];
  return (
    <span
      data-testid={`badge-urgency-${urgency}`}
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${c.className}`}
    >
      <Clock className="w-2.5 h-2.5 mr-1" />
      {c.label}
    </span>
  );
}

function edgeColorClass(edge: number): string {
  if (edge >= 0.05) return "text-[hsl(var(--color-gain))]";
  if (edge >= 0.02) return "text-[hsl(var(--chart-4))]";
  return "text-muted-foreground";
}

function probSumColorClass(sum: number): string {
  if (sum > 1.02) return "text-destructive";
  if (sum < 0.98) return "text-[hsl(var(--color-gain))]";
  return "text-muted-foreground";
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

function MispricingRow({
  opportunity,
}: {
  opportunity: MispricingOpportunity;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      data-testid={`mispricing-row-${opportunity.id}`}
      className="border-b border-border last:border-0"
    >
      <div
        className="py-3 px-4 hover:bg-accent/50 transition-colors cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        data-testid={`mispricing-toggle-${opportunity.id}`}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <a
                href={opportunity.polymarketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate max-w-[400px]"
                onClick={(e) => e.stopPropagation()}
                data-testid={`link-event-${opportunity.id}`}
              >
                {opportunity.eventTitle}
                <ExternalLink className="w-3 h-3 inline ml-1 opacity-50" />
              </a>
              <TypeBadge type={opportunity.type} />
              <UrgencyBadge urgency={opportunity.timeUrgency} />
            </div>

            <div className="flex items-center gap-4 text-xs flex-wrap">
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Raw Edge:</span>
                <span
                  className={`font-semibold tabular-nums ${edgeColorClass(opportunity.rawEdge)}`}
                >
                  {formatEdge(opportunity.rawEdge)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Effective:</span>
                <span
                  className={`font-semibold tabular-nums ${edgeColorClass(opportunity.effectiveEdge)}`}
                >
                  {formatEdge(opportunity.effectiveEdge)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Spread:</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatEdge(opportunity.spreadCost)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">P(sum):</span>
                <span
                  className={`font-semibold tabular-nums ${probSumColorClass(opportunity.probabilitySum)}`}
                >
                  {toNum(opportunity.probabilitySum).toFixed(3)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Liq:</span>
                <span className="tabular-nums">
                  {formatNumber(opportunity.liquidity)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Vol 24h:</span>
                <span className="tabular-nums">
                  {formatNumber(opportunity.volume24h)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <p
                className={`text-lg font-bold tabular-nums ${edgeColorClass(opportunity.rawEdge)}`}
              >
                {formatEdge(opportunity.rawEdge)}
              </p>
              <p className="text-[10px] text-muted-foreground">raw edge</p>
            </div>
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1">
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Outcome Breakdown
            </p>
            <div className="space-y-1.5">
              <div className="grid grid-cols-6 gap-2 text-[10px] text-muted-foreground font-medium border-b border-border pb-1">
                <span>Outcome</span>
                <span className="text-right">Mid</span>
                <span className="text-right">Bid</span>
                <span className="text-right">Ask</span>
                <span className="text-right">Spread</span>
                <span className="text-right">Token ID</span>
              </div>
              {opportunity.outcomes.map((o, idx) => (
                <div
                  key={idx}
                  data-testid={`outcome-row-${idx}`}
                  className="grid grid-cols-6 gap-2 text-xs"
                >
                  <span className="truncate text-foreground font-medium">
                    {o.name}
                  </span>
                  <span className="text-right tabular-nums">
                    {(toNum(o.midPrice) * 100).toFixed(1)}%
                  </span>
                  <span className="text-right tabular-nums text-muted-foreground">
                    {(toNum(o.bestBid) * 100).toFixed(1)}%
                  </span>
                  <span className="text-right tabular-nums text-muted-foreground">
                    {(toNum(o.bestAsk) * 100).toFixed(1)}%
                  </span>
                  <span className="text-right tabular-nums text-muted-foreground">
                    {(toNum(o.spread) * 100).toFixed(2)}%
                  </span>
                  <span className="text-right tabular-nums text-muted-foreground text-[10px] truncate">
                    {o.tokenId.slice(0, 8)}...
                  </span>
                </div>
              ))}
            </div>

            {(opportunity.estimatedSlippage100 > 0 ||
              opportunity.estimatedSlippage500 > 0) && (
              <div className="mt-3 pt-2 border-t border-border flex items-center gap-4 text-xs">
                <span className="text-muted-foreground">
                  Est. Slippage ($100):{" "}
                  <span className="text-foreground tabular-nums">
                    {(toNum(opportunity.estimatedSlippage100) * 100).toFixed(2)}%
                  </span>
                </span>
                <span className="text-muted-foreground">
                  Est. Slippage ($500):{" "}
                  <span className="text-foreground tabular-nums">
                    {(toNum(opportunity.estimatedSlippage500) * 100).toFixed(2)}%
                  </span>
                </span>
              </div>
            )}

            {opportunity.hoursToExpiry !== undefined && (
              <div className="mt-2 text-[10px] text-muted-foreground">
                Expires in{" "}
                {opportunity.hoursToExpiry < 24
                  ? `${toNum(opportunity.hoursToExpiry).toFixed(1)} hours`
                  : `${(toNum(opportunity.hoursToExpiry) / 24).toFixed(1)} days`}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Mispricing() {
  const [minEdge, setMinEdge] = useState(0);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [urgencyFilter, setUrgencyFilter] = useState<string>("all");

  const { data: mispricings, isLoading } = useQuery<MispricingOpportunity[]>({
    queryKey: ["/api/mispricings"],
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: stats, isLoading: statsLoading } = useQuery<MispricingStats>({
    queryKey: ["/api/mispricings/stats"],
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/mispricings/refresh");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mispricings"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/mispricings/stats"],
      });
    },
  });

  const filtered = (mispricings || []).filter((m) => {
    if (m.rawEdge < minEdge / 100) return false;
    if (typeFilter !== "all" && m.type !== typeFilter) return false;
    if (urgencyFilter !== "all" && m.timeUrgency !== urgencyFilter)
      return false;
    return true;
  });

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Crosshair className="w-5 h-5 text-primary" />
            Mispricing Scanner
          </h2>
          <p className="text-sm text-muted-foreground">
            Detecting probability sum deviations and arbitrage opportunities
            across Polymarket.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          data-testid="button-refresh-mispricings"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 mr-1.5 ${
              refreshMutation.isPending ? "animate-spin" : ""
            }`}
          />
          Scan Markets
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statsLoading ? (
          [...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <KPICard
              label="Mispricings Found"
              value={String(stats?.totalMispricings || 0)}
              icon={Target}
              delta="Active opportunities"
            />
            <KPICard
              label="Best Edge"
              value={
                stats?.bestEdge
                  ? `${(toNum(stats.bestEdge) * 100).toFixed(2)}%`
                  : "–"
              }
              icon={TrendingUp}
              delta="Highest raw edge"
            />
            <KPICard
              label="Average Edge"
              value={
                stats?.averageEdge
                  ? `${(toNum(stats.averageEdge) * 100).toFixed(2)}%`
                  : "–"
              }
              icon={Crosshair}
            />
            <KPICard
              label="Markets Scanned"
              value={String(stats?.marketsScanned || 0)}
              icon={DollarSign}
              delta={
                stats?.totalExploitableVolume
                  ? `${formatNumber(stats.totalExploitableVolume)} vol`
                  : undefined
              }
            />
          </>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-3 flex-1 min-w-[200px]">
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                Min Edge: {minEdge}%
              </span>
              <Slider
                data-testid="slider-min-edge"
                value={[minEdge]}
                onValueChange={(v) => setMinEdge(v[0])}
                min={0}
                max={20}
                step={0.5}
                className="flex-1"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Type:</span>
              <Select
                value={typeFilter}
                onValueChange={setTypeFilter}
              >
                <SelectTrigger
                  className="w-[130px] h-8 text-xs"
                  data-testid="select-type-filter"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="probability_sum">Prob Sum</SelectItem>
                  <SelectItem value="binary_deviation">Binary</SelectItem>
                  <SelectItem value="spread_arb">Spread Arb</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Urgency:</span>
              <Select
                value={urgencyFilter}
                onValueChange={setUrgencyFilter}
              >
                <SelectTrigger
                  className="w-[120px] h-8 text-xs"
                  data-testid="select-urgency-filter"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mispricings List */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            Detected Mispricings
            {filtered.length > 0 && (
              <Badge variant="secondary" className="text-[10px] ml-1">
                {filtered.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Crosshair className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">
                {mispricings && mispricings.length > 0
                  ? "No mispricings match your filters. Try adjusting the minimum edge."
                  : "No mispricings detected. Click Scan Markets to analyze."}
              </p>
            </div>
          ) : (
            <div
              className="max-h-[700px] overflow-y-auto"
              style={{ overscrollBehavior: "contain" }}
            >
              {filtered.map((opp) => (
                <MispricingRow key={opp.id} opportunity={opp} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
