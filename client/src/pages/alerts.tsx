import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bell, Plus, Trash2, ArrowUp, ArrowDown, Zap } from "lucide-react";
import { useState } from "react";
import type { AlertConfig, PolymarketEvent } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export default function Alerts() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [alertType, setAlertType] = useState<"probability_above" | "probability_below" | "momentum_shift">("probability_above");
  const [threshold, setThreshold] = useState("0.80");
  const [selectedMarket, setSelectedMarket] = useState<{
    marketId: string;
    marketQuestion: string;
    eventTitle: string;
  } | null>(null);

  const { data: alerts, isLoading } = useQuery<AlertConfig[]>({
    queryKey: ["/api/alerts"],
  });

  const { data: events } = useQuery<PolymarketEvent[]>({
    queryKey: ["/api/events/trending"],
    staleTime: 60_000,
    enabled: showCreate,
  });

  const createMutation = useMutation({
    mutationFn: async (data: {
      marketId: string;
      marketQuestion: string;
      eventTitle: string;
      type: "probability_above" | "probability_below" | "momentum_shift";
      threshold: number;
    }) => {
      const res = await apiRequest("POST", "/api/alerts", { ...data, enabled: true });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      setShowCreate(false);
      setSelectedMarket(null);
      toast({ title: "Alert created" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await apiRequest("PATCH", `/api/alerts/${id}`, { enabled });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/alerts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      toast({ title: "Alert deleted" });
    },
  });

  const alertTypeLabels = {
    probability_above: "Probability Above",
    probability_below: "Probability Below",
    momentum_shift: "Momentum Shift",
  };

  const alertTypeIcons = {
    probability_above: ArrowUp,
    probability_below: ArrowDown,
    momentum_shift: Zap,
  };

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" />
            Alerts
          </h2>
          <p className="text-sm text-muted-foreground">
            Set thresholds for probability or momentum shifts.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowCreate(!showCreate)}
          data-testid="button-create-alert"
        >
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          New Alert
        </Button>
      </div>

      {/* Create Alert Form */}
      {showCreate && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-semibold">Create Alert</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-4">
            {/* Select market */}
            <div>
              <p className="text-xs text-muted-foreground mb-2">Select a market</p>
              <div className="max-h-[200px] overflow-y-auto space-y-1 border border-border rounded-md p-2" style={{ overscrollBehavior: "contain" }}>
                {events?.slice(0, 15).map((event) =>
                  event.markets?.filter((m) => !m.closed).slice(0, 2).map((m) => (
                    <div
                      key={m.id}
                      className={`py-1.5 px-2 rounded text-xs cursor-pointer transition-colors ${
                        selectedMarket?.marketId === m.id
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-accent"
                      }`}
                      onClick={() =>
                        setSelectedMarket({
                          marketId: m.id,
                          marketQuestion: m.question,
                          eventTitle: event.title,
                        })
                      }
                    >
                      <span className="text-muted-foreground">{event.title} / </span>
                      {m.question}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Alert config */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Alert Type</p>
                <Select
                  value={alertType}
                  onValueChange={(v: any) => setAlertType(v)}
                >
                  <SelectTrigger data-testid="select-alert-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="probability_above">Probability Above</SelectItem>
                    <SelectItem value="probability_below">Probability Below</SelectItem>
                    <SelectItem value="momentum_shift">Momentum Shift</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">
                  Threshold ({alertType === "momentum_shift" ? "% change" : "probability"})
                </p>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  data-testid="input-threshold"
                />
              </div>
            </div>

            <Button
              size="sm"
              disabled={!selectedMarket || createMutation.isPending}
              onClick={() => {
                if (!selectedMarket) return;
                createMutation.mutate({
                  ...selectedMarket,
                  type: alertType,
                  threshold: parseFloat(threshold),
                });
              }}
              data-testid="button-save-alert"
            >
              Create Alert
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Alert List */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-12 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : alerts && alerts.length > 0 ? (
        <div className="space-y-2">
          {alerts.map((alert) => {
            const Icon = alertTypeIcons[alert.type];
            return (
              <Card key={alert.id} data-testid={`alert-${alert.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`p-1.5 rounded-md ${alert.enabled ? "bg-primary/10" : "bg-muted"}`}>
                        <Icon className={`w-3.5 h-3.5 ${alert.enabled ? "text-primary" : "text-muted-foreground"}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground truncate">{alert.eventTitle}</p>
                        <p className="text-sm font-medium truncate">{alert.marketQuestion}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant="secondary" className="text-[10px]">
                            {alertTypeLabels[alert.type]}
                          </Badge>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            Threshold: {(alert.threshold * 100).toFixed(0)}%
                          </span>
                          {alert.lastTriggered && (
                            <span className="text-[10px] text-muted-foreground">
                              Triggered: {new Date(alert.lastTriggered).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch
                        checked={alert.enabled}
                        onCheckedChange={(checked) =>
                          toggleMutation.mutate({ id: alert.id, enabled: checked })
                        }
                        data-testid={`switch-alert-${alert.id}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMutation.mutate(alert.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-16 text-muted-foreground">
          <Bell className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No alerts configured.</p>
          <p className="text-xs mt-1">Create alerts to get notified when markets hit your thresholds.</p>
        </div>
      )}
    </div>
  );
}
