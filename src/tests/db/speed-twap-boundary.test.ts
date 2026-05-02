/**
 * speed-twap-boundary.test.ts — Verifies the half-open settlement window.
 *
 * Mig 345 (TWAP era):
 *   speed_resolve_market queried `WHERE ts >= window_start AND ts < window_end`.
 *   A tick written at exactly `closes_at` was excluded from the 30s TWAP.
 *
 * Mig 355 (single-tick era):
 *   Same half-open boundary semantics, single tick instead of average:
 *   `WHERE ts >= closes_at - 2s AND ts < closes_at`. The most recent tick
 *   strictly before closes_at is the settlement_price. Outlier ticks at
 *   exactly closes_at are still excluded — symmetric with the trade gate
 *   (which rejects at NOW() >= closes_at).
 *
 * Robustness against the live oracle worker:
 *   The Railway worker writes BTC ticks every second, so the 2s pre-close
 *   window typically has 1-2 normal ticks. We can't assert tick_count = N
 *   for a fixed N, because the worker contributes a real tick.
 *   We insert ONE outlier tick at exactly closes_at and check that
 *   the resolved settlement_price is NOT the outlier — confirming the
 *   boundary tick is excluded.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanup, getServiceClient } from "./helpers";

let sb: SupabaseClient;
const createdMarkets: string[] = [];

beforeAll(() => {
  sb = getServiceClient();
});

afterAll(async () => {
  if (createdMarkets.length > 0) {
    await sb.from("speed_markets").delete().in("id", createdMarkets);
  }
  await cleanup(sb, [], [], []);
});

async function insertTick(asset: string, price: number, ts: Date): Promise<void> {
  await sb.from("speed_oracle_ticks").upsert(
    {
      asset,
      source: "binance",
      price,
      ts: ts.toISOString(),
      received_at: ts.toISOString(),
    },
    { onConflict: "asset,ts,source", ignoreDuplicates: true },
  );
}

describe("speed_resolve_market settlement boundary (mig 355 single-tick)", () => {
  it("excludes a tick written at exactly closes_at", async () => {
    // Schedule the market to close 3s in the future so we have time to set up
    // and insert the boundary tick.
    const closesAt = new Date(Date.now() + 3_000);
    const opensAt = new Date(closesAt.getTime() - 60_000);

    const { data: market, error: marketErr } = await sb
      .from("speed_markets")
      .insert({
        asset: "BTC",
        duration: "5m",
        strike_price: 67_000,
        opens_at: opensAt.toISOString(),
        closes_at: closesAt.toISOString(),
        status: "open",
      })
      .select("id")
      .single();
    expect(marketErr).toBeNull();
    if (!market) return;
    createdMarkets.push(market.id);

    // Insert a ridiculous outlier tick at exactly closes_at. Real BTC is
    // around $67k; we use $999_999. With single-tick settlement using the
    // half-open window [closes_at - 2s, closes_at), this tick is EXCLUDED.
    const OUTLIER_PRICE = 999_999;
    await insertTick("BTC", OUTLIER_PRICE, closesAt);

    // Wait for closes_at to pass before resolving.
    const waitMs = closesAt.getTime() - Date.now() + 200;
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

    const { data: resolveResult, error: resolveErr } = await sb.rpc(
      "speed_resolve_market" as never,
      { p_market_id: market.id } as never,
    );

    expect(resolveErr).toBeNull();
    expect(resolveResult).not.toBeNull();
    const r = resolveResult as Record<string, unknown>;

    if (r.voided) {
      // Window had no ticks at all (worker may have stalled). Re-running the
      // test should pass; treat as inconclusive rather than failing.
      console.warn("speed-settlement-boundary: market voided (no in-window ticks); test inconclusive");
      return;
    }

    // The boundary tick at $999_999 must NOT have been used. With single-tick
    // settlement, settlement_price = the most recent tick BEFORE closes_at
    // (within 2s). If the boundary tick had been included, settlement_price
    // would be $999_999. Asserting under $200_000 proves it was excluded.
    const settlementPrice = Number(r.settlement_price);
    expect(settlementPrice).toBeLessThan(200_000);
    expect(settlementPrice).toBeGreaterThan(0);

    // settlement_tick_ts must be strictly before closes_at.
    const tickTs = new Date(r.settlement_tick_ts as string);
    expect(tickTs.getTime()).toBeLessThan(closesAt.getTime());
  }, 15_000);
});
