"use client";

import { useEffect, useState } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useSession } from "@/lib/auth/hooks";
import type { Transaction } from "@/types/transaction";

/**
 * Fetch the current user's recent transactions and keep the list live.
 *
 * Initial load via REST `.select()`, then subscribes to `INSERT` events on
 * the `transactions` table filtered by `user_id`. New rows are prepended
 * in-place so the list stays sorted newest-first without a refetch.
 */
export function useTransactions(limit = 50) {
  const supabase = useSupabase();
  const { user } = useSession();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function fetchInitial() {
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch transactions:", error.message);
      }
      setTransactions((data as Transaction[]) || []);
      setLoading(false);
    }

    fetchInitial();

    // Realtime: new transactions for this user prepend to the list.
    const channel = supabase
      .channel(`transactions-user-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "transactions",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as Transaction;
          setTransactions((prev) => {
            // Dedup in case initial fetch + realtime race produces overlap
            if (prev.some((t) => t.id === row.id)) return prev;
            const next = [row, ...prev];
            return next.length > limit ? next.slice(0, limit) : next;
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [supabase, user, limit]);

  return { transactions, loading };
}
