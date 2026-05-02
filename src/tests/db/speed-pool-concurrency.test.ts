/**
 * speed-pool-concurrency.test.ts — Verifies mig 345's main-pool sentinel.
 *
 * Before mig 345:
 *   speed_execute_trade computed the main-pool balance by summing the entire
 *   speed_pool_ledger every call. Two concurrent retail trades would both
 *   read the same SUM, both insert ledger rows with the same balance_after,
 *   breaking the audit trail.
 *
 * After mig 345:
 *   FOR UPDATE on speed_main_pool_state serializes concurrent retail trades.
 *   balance_after on consecutive ledger rows forms a consistent linear chain.
 *
 * This test:
 *   1. Sets up a speed_market with a fresh oracle tick.
 *   2. Funds 5 retail users.
 *   3. Fires N concurrent speed_execute_trade RPCs via Promise.all.
 *   4. Reads the ledger rows for that market in PK order.
 *   5. Asserts: balance_after[i] = balance_after[i-1] + amount[i] for every
 *      adjacent pair.
 *
 * Pre-mig-345 this test would fail (some balance_after values are stale).
 * Post-mig-345 it passes.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cleanup,
  createAuthenticatedClient,
  getServiceClient,
} from "./helpers";

let sb: SupabaseClient;
const createdUsers: string[] = [];
const createdMarkets: string[] = [];
const authCleanups: (() => Promise<void>)[] = [];

beforeAll(() => {
  sb = getServiceClient();
});

afterAll(async () => {
  for (const fn of authCleanups) {
    await fn().catch(() => {});
  }
  // Best-effort cleanup of speed markets we created. Pool ledger rows are
  // append-only (mig 310 trigger blocks DELETE) — they persist; staging is
  // wiped periodically.
  if (createdMarkets.length > 0) {
    await sb.from("speed_markets").delete().in("id", createdMarkets);
  }
  await cleanup(sb, createdUsers, [], []);
});

async function setupOracleTick(price: number): Promise<void> {
  const now = new Date().toISOString();
  await sb.from("speed_oracle_latest").upsert(
    {
      asset: "BTC",
      source: "binance",
      price,
      ts: now,
      received_at: now,
    },
    { onConflict: "asset" },
  );
}

async function createOpenSpeedMarket(strike: number): Promise<string> {
  const { data, error } = await sb
    .from("speed_markets")
    .insert({
      asset: "BTC",
      duration: "5m",
      strike_price: strike,
      opens_at: new Date(Date.now() - 5_000).toISOString(),
      closes_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      status: "open",
    })
    .select("id")
    .single();
  if (error) throw new Error(`createOpenSpeedMarket failed: ${error.message}`);
  createdMarkets.push(data.id);
  return data.id as string;
}

describe("speed_pool_ledger main-pool concurrency (mig 345)", () => {
  it("balance_after on retail-flow ledger rows forms a consistent linear chain", async () => {
    // 0. Pre-fund the main pool sentinel high enough that the per-market
    //    exposure cap (mig 340) doesn't trip on small test stakes.
    //    cap = pool × 0.40, trip threshold per side = stake × 2 (proxy).
    //    With $10k pool, cap = $4k, well above $200 worst-case for our stakes.
    //    Note: there's a pre-existing format() bug in the cap-trip error
    //    message that surfaces if we hit the cap; pre-funding avoids it.
    await sb
      .from("speed_main_pool_state")
      .upsert({ id: 1, speed_pool_balance: 10_000, updated_at: new Date().toISOString() }, { onConflict: "id" });

    // 1. Oracle tick — needs to be < 2s old at trade time (retried inline below).
    await setupOracleTick(67_000);

    // 2. Market with strike at current spot.
    const marketId = await createOpenSpeedMarket(67_000);

    // 3. Five retail users, each funded with $200.
    const traders: Array<{
      client: SupabaseClient;
      userId: string;
    }> = [];
    for (let i = 0; i < 5; i++) {
      const c = await createAuthenticatedClient(sb, {
        balance_usd: 200,
        signup_branch_id: null,
      });
      authCleanups.push(c.cleanup);
      createdUsers.push(c.userId);
      traders.push({ client: c.client, userId: c.userId });
    }

    // 4. Fire 5 concurrent trades. Each user bets a different stake on
    //    alternating sides so per-side caps don't trip.
    await setupOracleTick(67_000); // refresh tick right before firing
    const stakes = [10, 11, 12, 13, 14];
    const sides: Array<"over" | "under"> = ["over", "under", "over", "under", "over"];

    const results = await Promise.all(
      traders.map((t, i) =>
        t.client.rpc("speed_execute_trade" as never, {
          p_market_id: marketId,
          p_side: sides[i],
          p_stake: stakes[i],
          p_idempotency_key: `concurrency-test-${marketId}-${i}`,
        } as never),
      ),
    );

    // Some trades may legitimately fail (oracle race, etc.); only assert on
    // the chain of rows that actually committed.
    const successCount = results.filter((r) => !r.error).length;
    expect(successCount).toBeGreaterThanOrEqual(2);

    // 5. Read ledger rows for this market, branch_id IS NULL (retail/main pool).
    // Sort by balance_after ASC: in mig 345's locked flow, balance_after is
    // strictly monotonic in commit order (each trade increments by its stake).
    // created_at can tie at sub-microsecond resolution under fast concurrent
    // commits — balance_after is the safer ordering.
    const { data: ledger, error: ledgerErr } = await sb
      .from("speed_pool_ledger")
      .select("amount, balance_after, type, created_at")
      .eq("market_id", marketId)
      .is("branch_id", null)
      .order("balance_after", { ascending: true });

    expect(ledgerErr).toBeNull();
    expect(ledger).not.toBeNull();
    if (!ledger) return;

    // 6. Assert: balance_after[i] - balance_after[i-1] == amount[i] for each
    //    consecutive pair. Pre-mig-345 some pairs would be off.
    for (let i = 1; i < ledger.length; i++) {
      const prev = Number(ledger[i - 1].balance_after);
      const curr = Number(ledger[i].balance_after);
      const amt = Number(ledger[i].amount);
      const delta = Math.round((curr - prev) * 100) / 100;
      const amtRounded = Math.round(amt * 100) / 100;
      expect(delta).toBe(amtRounded);
    }
  }, 30_000);
});
