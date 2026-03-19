import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Eye, Trash2, Plus, Search, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import type { WatchlistItem, PolymarketEvent, PolymarketMarket } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

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

export default function Watchlist() {
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const { toast } = useToast();

  const { data: watchlist, isLoading } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/watchlist"],
  });

  const { data: searchResults, isLoading: searching } = useQuery<PolymarketEvent[]>({
    queryKey: ["/api/events/trending"],
    staleTime: 60_000,
    enabled: showSearch,
  });

  const addMutation = useMutation({
    mutationFn: async (item: { eventId: string; eventTitle: string; marketId: string; marketQuestion: string }) => {
      const res = await apiRequest("POST", "/api/watchlist", item);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      toast({ title: "Added to watchlist" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/watchlist/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      toast({ title: "Removed from watchlist" });
    },
  });

  const filteredResults = searchResults?.filter((e) =>
    e.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Eye className="w-5 h-5 text-primary" />
            Watchlist
          </h2>
          <p className="text-sm text-muted-foreground">
            Track specific markets and events you're interested in.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowSearch(!showSearch)}
          data-testid="button-add-to-watchlist"
        >
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Add Market
        </Button>
      </div>

      {/* Search Panel */}
      {showSearch && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-semibold">Browse Markets</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Filter events..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-markets"
              />
            </div>
            <div className="max-h-[300px] overflow-y-auto space-y-1" style={{ overscrollBehavior: "contain" }}>
              {searching ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : (
                filteredResults?.slice(0, 15).map((event) => (
                  <div key={event.id}>
                    {event.markets?.filter((m) => !m.closed).slice(0, 2).map((market) => {
                      const parsed = parseOutcomes(market);
                      const topPrice = parsed.sort((a: any, b: any) => b.price - a.price)[0];
                      return (
                        <div
                          key={market.id}
                          className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-accent/50"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-muted-foreground truncate">{event.title}</p>
                            <p className="text-sm truncate">{market.question}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {topPrice && (
                              <span className="text-xs tabular-nums font-medium">
                                {(topPrice.price * 100).toFixed(0)}%
                              </span>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                addMutation.mutate({
                                  eventId: event.id,
                                  eventTitle: event.title,
                                  marketId: market.id,
                                  marketQuestion: market.question,
                                })
                              }
                              disabled={addMutation.isPending}
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Watchlist Items */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-12 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : watchlist && watchlist.length > 0 ? (
        <div className="space-y-2">
          {watchlist.map((item) => (
            <Card key={item.id} data-testid={`watchlist-item-${item.id}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">{item.eventTitle}</p>
                    <p className="text-sm font-medium">{item.marketQuestion}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Added {new Date(item.addedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeMutation.mutate(item.id)}
                      data-testid={`button-remove-${item.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-muted-foreground">
          <Eye className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Your watchlist is empty.</p>
          <p className="text-xs mt-1">Click "Add Market" to start tracking events.</p>
        </div>
      )}
    </div>
  );
}
