/**
 * price-history.test.ts — tests for the production `get_price_history` RPC.
 *
 * Coverage gap filler: the production chart backend had zero tests before this
 * file (only `demo_get_price_history` was covered). This file mirrors the demo
 * test patterns against the real `trades` + `amm_state` tables.
 *
 * RPC signature (migration 164):
 *   get_price_history(p_market_id UUID, p_period TEXT DEFAULT '1D',
 *                     p_created_at TIMESTAMPTZ DEFAULT NULL)
 * Returns: (bucket_time TIMESTAMPTZ, yes_price DECIMAL, no_price DECIMAL)
 *
 * Periods: 1H, 6H, 12H, 1D, 1W, 1M, ALL
 * Unknown period falls through to 1D default (no rejection).
 * Empty markets yield buckets at LMSR initial price (0.5 / 0.5).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getServiceClient,
  createAuthenticatedClient,
  createTestMarket,
  cleanup,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("get_price_history RPC (production)", () => {
  let serviceClient: SupabaseClient;
  const userIds: string[] = [];
  const marketIds: string[] = [];
  const authCleanups: (() => Promise<void>)[] = [];
  let adminId: string;
  let traderClient: SupabaseClient | null = null;
  let authSupported = false;

  beforeAll(async () => {
    serviceClient = getServiceClient();
    adminId = await (async () => {
      const admin = await createAuthenticatedClient(serviceClient, {
        is_admin: true,
        balance_usd: 10000,
      });
      userIds.push(admin.userId);
      authCleanups.push(admin.cleanup);
      return admin.userId;
    })();

    try {
      const trader = await createAuthenticatedClient(serviceClient, {
        balance_usd: 2000,
      });
      traderClient = trader.client;
      userIds.push(trader.userId);
      authCleanups.push(trader.cleanup);
      authSupported = true;
    } catch {
      authSupported = false;
    }
  });

  afterAll(async () => {
    for (const fn of authCleanups) await fn();
    await cleanup(serviceClient, userIds, marketIds);
  });

  // ─── Test 1: empty market → all buckets at LMSR initial price 0.5 ─────
  it("empty market returns buckets at initial LMSR price (0.5 / 0.5)", async () => {
    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    const { data, error } = await serviceClient.rpc("get_price_history", {
      p_market_id: marketId,
      p_period: "1D",
    });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(data!.length).toBeGreaterThan(0);

    for (const row of data!) {
      expect(row).toHaveProperty("bucket_time");
      expect(Number(row.yes_price)).toBeCloseTo(0.5, 4);
      expect(Number(row.no_price)).toBeCloseTo(0.5, 4);
    }
  });

  // ─── Test 2: after a trade, buckets are monotonic and reflect post-trade price ─
  // Note: the RPC buckets by fixed intervals (5 min for 1D), so a trade that
  // just happened falls into "dead space" after the last generate_series boundary
  // until the next interval rolls. We backdate a trade via direct INSERT so it
  // lands squarely inside a past bucket and the RPC must surface it.
  it("buckets are monotonic; post_yes_price surfaces once trade is in range", async () => {
    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    const traderId = await (async () => {
      const t = await createAuthenticatedClient(serviceClient, {
        balance_usd: 2000,
      });
      userIds.push(t.userId);
      authCleanups.push(t.cleanup);
      return t.userId;
    })();

    // Backdate by 10 minutes so the trade falls inside multiple past 1D buckets
    const backdated = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const postYes = 0.72;
    const postNo = 0.28;

    const { error: insertErr } = await serviceClient.from("trades").insert({
      user_id: traderId,
      market_id: marketId,
      side: "yes",
      direction: "buy",
      shares: 40,
      price_per_share: 0.55,
      total_cost: 22,
      explicit_fee: 0.11,
      post_yes_price: postYes,
      post_no_price: postNo,
      created_at: backdated,
    });
    expect(insertErr).toBeNull();

    const { data, error } = await serviceClient.rpc("get_price_history", {
      p_market_id: marketId,
      p_period: "1D",
    });
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);

    // Bucket times strictly non-decreasing
    for (let i = 1; i < data!.length; i++) {
      expect(
        new Date(data![i].bucket_time).getTime()
      ).toBeGreaterThanOrEqual(
        new Date(data![i - 1].bucket_time).getTime()
      );
    }

    // Post-trade buckets reflect the backdated trade's post_yes_price.
    // At least one bucket should carry the new price.
    const maxYes = Math.max(
      ...(data as Array<{ yes_price: number }>).map((r) => Number(r.yes_price))
    );
    expect(maxYes).toBeCloseTo(postYes, 2);

    // All prices stay in [0,1] and yes+no ~= 1
    for (const row of data!) {
      const y = Number(row.yes_price);
      const n = Number(row.no_price);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
      expect(y + n).toBeCloseTo(1.0, 2);
    }
  });

  // ─── Test 3: all 7 periods execute without error and return rows ──────
  it("returns rows for every supported period including ALL with p_created_at", async () => {
    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    const { data: market } = await serviceClient
      .from("markets")
      .select("created_at")
      .eq("id", marketId)
      .single();

    const periods = ["1H", "6H", "12H", "1D", "1W", "1M", "ALL"] as const;
    for (const period of periods) {
      const { data, error } = await serviceClient.rpc("get_price_history", {
        p_market_id: marketId,
        p_period: period,
        p_created_at: period === "ALL" ? market!.created_at : null,
      });
      expect(error, `period ${period} errored`).toBeNull();
      expect(Array.isArray(data), `period ${period} should return array`).toBe(true);
      expect(data!.length, `period ${period} empty`).toBeGreaterThan(0);
    }

    // Unknown period falls through to 1D default (no rejection)
    const { data: unknownData, error: unknownErr } = await serviceClient.rpc(
      "get_price_history",
      { p_market_id: marketId, p_period: "BOGUS" }
    );
    expect(unknownErr).toBeNull();
    expect(Array.isArray(unknownData)).toBe(true);
    expect(unknownData!.length).toBeGreaterThan(0);
  });
});
