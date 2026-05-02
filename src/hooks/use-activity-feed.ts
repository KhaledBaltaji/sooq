"use client";

import { useEffect, useRef, useState } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import type { TradeDirection } from "@/types/database";
import { ACTIVITY_FEED_THROTTLE_MS, ACTIVITY_FEED_MAX_ITEMS } from "@/lib/constants";

export interface FeedItem {
  id: string;
  side: string;
  direction: TradeDirection;
  shares: number;
  price_per_share: number;
  total_cost: number;
  created_at: string;
}

export function useActivityFeed(marketId?: string) {
  const supabase = useSupabase();
  const [items, setItems] = useState<FeedItem[]>([]);
  const queueRef = useRef<FeedItem[]>([]);
  const lastUpdateRef = useRef<number>(0);

  useEffect(() => {
    async function fetchRecent() {
      let query = supabase
        .from("trades")
        .select("id, side, direction, shares, price_per_share, total_cost, created_at")
        .order("created_at", { ascending: false })
        .limit(ACTIVITY_FEED_MAX_ITEMS);

      if (marketId) {
        query = query.eq("market_id", marketId);
      }

      const { data, error } = await query;
      if (error) {
        console.error("Failed to fetch activity feed:", error.message);
      }
      if (data) setItems(data as FeedItem[]);
    }

    fetchRecent();

    // Realtime with throttle
    const channel = supabase
      .channel("activity-feed")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "trades",
          ...(marketId ? { filter: `market_id=eq.${marketId}` } : {}),
        },
        (payload) => {
          const newItem = payload.new as FeedItem;
          const now = Date.now();

          if (now - lastUpdateRef.current >= ACTIVITY_FEED_THROTTLE_MS) {
            setItems((prev) => [newItem, ...prev].slice(0, ACTIVITY_FEED_MAX_ITEMS));
            lastUpdateRef.current = now;
          } else {
            queueRef.current.push(newItem);
          }
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.error("Activity feed realtime subscription error");
        }
      });

    // Drain queue periodically
    const interval = setInterval(() => {
      if (queueRef.current.length > 0) {
        const batch = queueRef.current.splice(0);
        setItems((prev) => [...batch, ...prev].slice(0, ACTIVITY_FEED_MAX_ITEMS));
        lastUpdateRef.current = Date.now();
      }
    }, ACTIVITY_FEED_THROTTLE_MS);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [supabase, marketId]);

  return { items };
}
