import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, RefreshCw, TrendingUp, BarChart3, Zap, Clock } from "lucide-react";
import type { DailyReport, MarketInsight } from "@shared/schema";

function SignalBadge({ signal }: { signal: MarketInsight["signal"] }) {
  const config = {
    strong_buy: { label: "Strong Buy", className: "bg-[hsl(var(--color-gain))]/15 text-[hsl(var(--color-gain))]" },
    buy: { label: "Buy", className: "bg-[hsl(var(--color-gain))]/10 text-[hsl(var(--color-gain))]/80" },
    hold: { label: "Hold", className: "bg-muted text-muted-foreground" },
    avoid: { label: "Avoid", className: "bg-destructive/10 text-destructive" },
  };
  const c = config[signal];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.className}`}>
      {c.label}
    </span>
  );
}

export default function Reports() {
  const { data: report, isLoading } = useQuery<DailyReport>({
    queryKey: ["/api/reports/latest"],
    retry: false,
  });

  const { data: allReports } = useQuery<DailyReport[]>({
    queryKey: ["/api/reports"],
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reports/generate");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reports/latest"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Daily Reports
          </h2>
          <p className="text-sm text-muted-foreground">
            AI-generated market summary. Scheduled daily at 10 AM AEDT.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          data-testid="button-generate-report"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 mr-1.5 ${
              generateMutation.isPending ? "animate-spin" : ""
            }`}
          />
          Generate Now
        </Button>
      </div>

      {isLoading || generateMutation.isPending ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <Skeleton className="h-16 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardContent className="p-4">
              <Skeleton className="h-48 w-full" />
            </CardContent>
          </Card>
        </div>
      ) : report ? (
        <>
          {/* Report Header */}
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            <span>Report for {report.date}</span>
            <span className="text-[10px]">
              Generated {new Date(report.generatedAt).toLocaleString()}
            </span>
          </div>

          {/* Market Overview */}
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-md bg-primary/10">
                  <BarChart3 className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Active Markets</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {report.marketSummary.totalActive}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-md bg-[hsl(var(--chart-4))]/10">
                  <TrendingUp className="w-4 h-4 text-[hsl(var(--chart-4))]" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">High Volume</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {report.marketSummary.highVolume}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-md bg-[hsl(var(--chart-5))]/10">
                  <Zap className="w-4 h-4 text-[hsl(var(--chart-5))]" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Big Movers</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {report.marketSummary.bigMovers}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Top Opportunities */}
          {report.topOpportunities.length > 0 && (
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Top Opportunities
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {report.topOpportunities.map((opp, i) => (
                    <div
                      key={opp.id}
                      className="px-4 py-3 flex items-start gap-4"
                      data-testid={`report-opp-${i}`}
                    >
                      <span className="text-xs font-mono text-muted-foreground w-4 pt-0.5 tabular-nums">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">{opp.marketQuestion}</p>
                          <SignalBadge signal={opp.signal} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{opp.eventTitle}</p>
                        <p className="text-xs text-muted-foreground mt-1">{opp.reasoning}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-semibold tabular-nums">
                          {(opp.currentProbability * 100).toFixed(0)}%
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {(opp.confidence * 100).toFixed(0)}% conf
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Previous Reports */}
          {allReports && allReports.length > 1 && (
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm font-semibold">Report History</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {allReports
                    .slice()
                    .reverse()
                    .map((r) => (
                      <div
                        key={r.id}
                        className="px-4 py-2.5 flex items-center justify-between text-xs"
                      >
                        <span>{r.date}</span>
                        <div className="flex items-center gap-4 text-muted-foreground">
                          <span>{r.topOpportunities.length} opportunities</span>
                          <span>{r.marketSummary.totalActive} markets</span>
                          <span className="text-[10px]">
                            {new Date(r.generatedAt).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <div className="text-center py-16 text-muted-foreground">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No reports generated yet.</p>
          <p className="text-xs mt-1">Click "Generate Now" for an instant analysis.</p>
        </div>
      )}
    </div>
  );
}
