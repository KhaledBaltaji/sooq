/**
 * speed-idempotency-retry.test.ts — Verifies the server's idempotency check
 * on speed_execute_trade.
 *
 * The matching client-side fix (mig 345 plan B7) makes the idempotency_key
 * stable across retries by deriving it from (market, side, stake, 5s-bucket).
 * That guarantees a network retry hits the server with the same key, and the
 * server returns the existing position rather than creating a duplicate.
 *
 * This test verifies the SERVER side of that contract: same key on a retry
 * → second call returns idempotent: true with the same position_id and the
 * user's balance was only debited once.
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
  if (createdMarkets.length > 0) {
    await sb.from("speed_markets").delete().in("id", createdMarkets);
  }
  await cleanup(sb, createdUsers, [], []);
});

describe("speed_execute_trade idempotency", () => {
  it("same idempotency_key on retry returns existing position; balance debited once", async () => {
    // Pre-fund the main pool so the per-market exposure cap doesn't trip
    // and so prior-test-run drift doesn't leave the sentinel underflowed.
    await sb
      .from("speed_main_pool_state")
      .upsert({ id: 1, speed_pool_balance: 10_000, updated_at: new Date().toISOString() }, { onConflict: "id" });

    // Read the LIVE oracle price and use it as both the freshness upsert
    // and the strike. This avoids a time-bomb fixture where a hardcoded
    // strike (e.g. $67k) drifts away from real BTC (e.g. $77k) until
    // d² explodes inside normal_cdf and EXP() raises 22003 underflow.
    // With strike ≈ spot at trade time, d² ≈ 0 regardless of how far
    // real BTC has moved since this test was written.
    const { data: liveOracle } = await sb
      .from("speed_oracle_latest")
      .select("price")
      .eq("asset", "BTC")
      .maybeSingle();
    const referencePrice = Number(liveOracle?.price ?? 67_000);

    // Fresh oracle tick (within 2s freshness window). Match the reference
    // price so the live oracle worker doesn't fight us for the row.
    const now = new Date().toISOString();
    await sb.from("speed_oracle_latest").upsert(
      {
        asset: "BTC",
        source: "binance",
        price: referencePrice,
        ts: now,
        received_at: now,
      },
      { onConflict: "asset" },
    );

    // Open speed market — strike = live spot, so the BS pricing in
    // speed_execute_trade gets d² ≈ 0 (ATM) at trade time.
    const { data: market, error: marketErr } = await sb
      .from("speed_markets")
      .insert({
        asset: "BTC",
        duration: "5m",
        strike_price: referencePrice,
        opens_at: new Date(Date.now() - 5_000).toISOString(),
        closes_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        status: "open",
      })
      .select("id")
      .single();
    expect(marketErr).toBeNull();
    if (!market) return;
    createdMarkets.push(market.id);

    // Retail user funded with $100.
    const { client, userId, cleanup: userCleanup } = await createAuthenticatedClient(sb, {
      balance_usd: 100,
      signup_branch_id: null,
    });
    authCleanups.push(userCleanup);
    createdUsers.push(userId);

    const stableKey = `idem-test-${market.id}-over-10-fixed-bucket`;

    // First call: places the bet.
    const first = await client.rpc("speed_execute_trade" as never, {
      p_market_id: market.id,
      p_side: "over",
      p_stake: 10,
      p_idempotency_key: stableKey,
    } as never);
    expect(first.error).toBeNull();
    const firstData = first.data as Record<string, unknown>;
    expect(firstData.success ?? firstData.idempotent).toBeTruthy();
    const firstPositionId = firstData.position_id as string;
    expect(firstPositionId).toBeTruthy();

    // Tiny delay simulating a network retry.
    await new Promise((r) => setTimeout(r, 100));

    // Second call with the SAME key: should return idempotent + same position.
    const second = await client.rpc("speed_execute_trade" as never, {
      p_market_id: market.id,
      p_side: "over",
      p_stake: 10,
      p_idempotency_key: stableKey,
    } as never);
    expect(second.error).toBeNull();
    const secondData = second.data as Record<string, unknown>;
    expect(secondData.idempotent).toBe(true);
    expect(secondData.position_id).toBe(firstPositionId);

    // Balance debited exactly once.
    const { data: user } = await sb
      .from("users")
      .select("balance_usd")
      .eq("id", userId)
      .single();
    expect(Number(user?.balance_usd)).toBe(90);

    // Exactly one position row exists.
    const { count } = await sb
      .from("speed_positions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("market_id", market.id);
    expect(count).toBe(1);
  }, 15_000);
});
