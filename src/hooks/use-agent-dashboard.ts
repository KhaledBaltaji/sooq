"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import type {
  AgentDashboardStats,
  AgentNetworkFlat,
  AgentNetworkNode,
  AgentCommissionFeedItem,
  AgentWalletSummary,
} from "@/types/agent";
import { ACTIVITY_FEED_THROTTLE_MS, ACTIVITY_FEED_MAX_ITEMS } from "@/lib/constants";
import { buildNetworkTree } from "@/lib/build-network-tree";

// ─── Agent Wallet Summary (PR 1 / migration 250) ─────────────
// Thin wrapper over get_agent_wallet_summary RPC. Returns
// available vs pending split so the wallet UI can render both.
// Prefer this over useAgentStats when you only need the wallet
// breakdown — it's a cheap single-row read.

export function useAgentWalletSummary(userId?: string) {
  const supabase = useSupabase();
  const [summary, setSummary] = useState<AgentWalletSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    // Cast supabase to any because get_agent_wallet_summary is defined in
    // migration 250 and not yet in the auto-generated RPC type union. Remove
    // once `supabase gen types` is re-run post-migration.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: rpcError } = await (supabase as any).rpc("get_agent_wallet_summary");
    if (rpcError) {
      setError(rpcError.message);
    } else if (data) {
      setSummary(data as unknown as AgentWalletSummary);
    }
    setLoading(false);
  }, [supabase, userId]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      setSummary(null);
      return;
    }
    fetch();
  }, [fetch, userId]);

  return { summary, loading, error, refetch: fetch };
}

// ─── Agent Stats ─────────────────────────────────────────────

export function useAgentStats(userId?: string) {
  const supabase = useSupabase();
  const [stats, setStats] = useState<AgentDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("get_agent_stats");
    if (rpcError) {
      setError(rpcError.message);
    } else if (data) {
      setStats(data as unknown as AgentDashboardStats);
    }
    setLoading(false);
  }, [supabase, userId]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      setStats(null);
      return;
    }
    fetch();
  }, [fetch, userId]);

  return { stats, loading, error, refetch: fetch };
}

// ─── Agent Network Tree ──────────────────────────────────────

export function useAgentNetwork(userId?: string) {
  const supabase = useSupabase();
  const [tree, setTree] = useState<AgentNetworkNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    async function fetchTree() {
      setLoading(true);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc("get_agent_network_flat");
      if (rpcError) {
        setError(rpcError.message);
      } else if (data) {
        const flat = data as unknown as AgentNetworkFlat;
        setTree(buildNetworkTree(flat));
      }
      setLoading(false);
    }

    fetchTree();
  }, [supabase, userId]);

  return { tree, loading, error };
}

// ─── Commission Feed (with Realtime) ─────────────────────────

export function useAgentCommissionFeed(layerFilter?: 1 | 2, userId?: string) {
  const supabase = useSupabase();
  const [items, setItems] = useState<AgentCommissionFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);
  const queueRef = useRef<AgentCommissionFeedItem[]>([]);
  const lastUpdateRef = useRef(0);

  const fetchPage = useCallback(async (reset = false) => {
    if (!userId) return;
    if (reset) {
      offsetRef.current = 0;
      setItems([]);
    }
    setLoading(true);

    const { data, error } = await supabase.rpc("get_agent_commission_feed", {
      p_limit: ACTIVITY_FEED_MAX_ITEMS,
      p_offset: offsetRef.current,
      p_layer_filter: layerFilter ?? null,
    });

    if (error) {
      console.error("Failed to fetch commission feed:", error.message);
    } else if (data) {
      const parsed = data as unknown as AgentCommissionFeedItem[];
      if (reset) {
        setItems(parsed);
      } else {
        setItems((prev) => [...prev, ...parsed]);
      }
      setHasMore(parsed.length === ACTIVITY_FEED_MAX_ITEMS);
      offsetRef.current += parsed.length;
    }
    setLoading(false);
  }, [supabase, userId, layerFilter]);

  // Initial fetch + re-fetch on filter change
  useEffect(() => {
    fetchPage(true);
  }, [fetchPage]);

  // Realtime subscription for new commissions
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel("agent-commission-feed")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "referral_commissions",
          filter: `referrer_id=eq.${userId}`,
        },
        async (payload) => {
          const row = payload.new as Record<string, unknown>;

          // Skip if layer filter active and doesn't match
          if (layerFilter && row.layer !== layerFilter) return;

          // Fetch full enriched details via RPC (market question, trader name, etc.)
          let newItem: AgentCommissionFeedItem;
          const { data: enriched } = await supabase.rpc("get_agent_commission_feed", {
            p_limit: 1,
            p_offset: 0,
            p_layer_filter: null,
          });

          const enrichedItems = enriched as unknown as AgentCommissionFeedItem[] | null;
          const match = enrichedItems?.find((item) => item.id === row.id);

          if (match) {
            newItem = match;
          } else {
            // Fallback: use raw row data if enrichment fails
            newItem = {
              id: row.id as string,
              trader_name: "Trader",
              market_question: "",
              trade_side: null,
              trade_amount: null,
              platform_revenue: Number(row.platform_revenue_amount),
              commission_amount: Number(row.commission_amount),
              layer: row.layer as 1 | 2,
              revenue_type: row.revenue_type as "trade" | "resolution",
              status: (row.status as "credited" | "escrowed") ?? "credited",
              created_at: row.created_at as string,
              unlock_at: (row.unlock_at as string | null | undefined) ?? null,
            };
          }

          const now = Date.now();
          if (now - lastUpdateRef.current >= ACTIVITY_FEED_THROTTLE_MS) {
            setItems((prev) => [newItem, ...prev]);
            lastUpdateRef.current = now;
          } else {
            queueRef.current.push(newItem);
          }
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.error("Agent commission feed realtime subscription error");
        }
      });

    const interval = setInterval(() => {
      if (queueRef.current.length > 0) {
        const batch = queueRef.current.splice(0);
        setItems((prev) => [...batch, ...prev]);
        lastUpdateRef.current = Date.now();
      }
    }, ACTIVITY_FEED_THROTTLE_MS);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [supabase, userId, layerFilter]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) fetchPage(false);
  }, [loading, hasMore, fetchPage]);

  return { items, loading, hasMore, loadMore };
}
