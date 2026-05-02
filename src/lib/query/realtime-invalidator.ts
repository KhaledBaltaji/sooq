"use client";

import { useEffect } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import type {
  RealtimePostgresChangesFilter,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { logger } from "@/lib/logger";

type PostgresChangesEvent = "INSERT" | "UPDATE" | "DELETE" | "*";

interface UseRealtimeInvalidationOptions {
  /**
   * Unique channel name. Use something descriptive and stable (e.g. "markets-list").
   * If two components use the same name concurrently, Supabase will merge them —
   * include a discriminator (e.g. userId, marketId) if you need per-row channels.
   */
  channel: string;
  /** Postgres table to subscribe to. */
  table: string;
  /** Event to listen for. Default "*". */
  event?: PostgresChangesEvent;
  /** Optional realtime filter (e.g. `user_id=eq.<uuid>`). */
  filter?: string;
  /** Query keys to invalidate on every matching change. */
  invalidates: QueryKey[];
  /** Set to false to disable the subscription (e.g. while auth is loading). */
  enabled?: boolean;
  /** Optional callback fired on each change, after invalidation. */
  onChange?: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
}

/**
 * Subscribe to Supabase realtime changes on a table and invalidate React Query
 * keys whenever a change arrives.
 *
 * Replaces the ad-hoc `useEffect` + `supabase.channel().on()` blocks scattered
 * throughout the old hook layer. One subscription, declarative invalidations,
 * automatic cleanup on unmount.
 *
 * Example:
 *   useRealtimeInvalidation({
 *     channel: "markets-list",
 *     table: isDemo ? "demo_markets" : "markets",
 *     event: "*",
 *     invalidates: [queryKeys.markets.all(isDemo)],
 *   });
 *
 * Notes:
 * - If the channel errors (network drop, auth expiry), we log once to the
 *   logger. React Query will still serve cached data; when reconnection
 *   succeeds Supabase replays fresh state.
 * - Arrays in `invalidates` are compared by identity in the effect deps.
 *   Use stable references (from `queryKeys.*` factory) to avoid churn.
 */
export function useRealtimeInvalidation({
  channel,
  table,
  event = "*",
  filter,
  invalidates,
  enabled = true,
  onChange,
}: UseRealtimeInvalidationOptions): void {
  const queryClient = useQueryClient();

  // Serialize invalidates to a stable string for dep tracking.
  const invalidatesKey = JSON.stringify(invalidates);

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    const realtimeChannel = supabase.channel(channel);

    const subscription: RealtimePostgresChangesFilter<PostgresChangesEvent> = {
      event,
      schema: "public",
      table,
      ...(filter ? { filter } : {}),
    };

    realtimeChannel
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on<any>("postgres_changes" as never, subscription, (payload) => {
        for (const key of invalidates) {
          queryClient.invalidateQueries({ queryKey: key });
        }
        onChange?.(payload);
      })
      .subscribe((status, err) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          logger.warn("realtime channel error", {
            context: { channel, table, status, error: err?.message },
            source: "realtime-invalidator",
          });
        }
      });

    return () => {
      supabase.removeChannel(realtimeChannel);
    };
    // `invalidatesKey` covers the `invalidates` array; `onChange` intentionally
    // excluded so callers can pass inline closures without re-subscribing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, table, event, filter, enabled, invalidatesKey, queryClient]);
}
