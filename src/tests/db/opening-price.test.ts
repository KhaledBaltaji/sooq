/**
 * opening-price.test.ts — tests for admin_create_market opening_price feature
 *
 * Migration 279 adds `markets.opening_price` (0.05-0.95, default 0.5) and extends
 * `admin_create_market` to pre-mint seed shares so the AMM's initial price
 * matches the admin's chosen opening price.
 *
 * Formulas:
 *   - p >= 0.5: q_yes = b × ln(p/(1-p)), q_no = 0
 *   - p <  0.5: q_yes = 0, q_no = b × ln((1-p)/p)
 *   - p == 0.5: both sides stay 0 (classic 50/50 behavior)
 *
 * Iron invariants:
 *   - amm_state.retail_shares_yes / retail_shares_no / retail_net_cash always 0 at creation
 *     (seed shares are operator inventory, not retail)
 *   - CHECK constraint rejects values outside [0.05, 0.95]
 *   - lmsr_price(b, q_yes, q_no, 'yes') ≈ opening_price (within rounding)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getServiceClient,
  createAuthenticatedClient,
  cleanup,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("admin_create_market opening_price", () => {
  let serviceClient: SupabaseClient;
  const userIds: string[] = [];
  const marketIds: string[] = [];
  const branchIds: string[] = [];
  const authCleanups: Array<() => Promise<void>> = [];
  let adminId: string;
  let adminClient: SupabaseClient;

  beforeAll(async () => {
    serviceClient = getServiceClient();
    const admin = await createAuthenticatedClient(serviceClient, {
      is_admin: true,
      balance_usd: 1_000_000,
    });
    adminId = admin.userId;
    adminClient = admin.client;
    userIds.push(adminId);
    authCleanups.push(admin.cleanup);
  });

  afterAll(async () => {
    for (const fn of authCleanups) await fn().catch(() => {});
    await cleanup(serviceClient, userIds, marketIds, branchIds);
  });

  // Helper — create via admin RPC, return {market_id, opening_price, seed_q_yes, seed_q_no}
  const createMarket = async (opening_price: number, b = 1000) => {
    const { data, error } = await adminClient.rpc("admin_create_market", {
      p_question_en: `Test ${opening_price} market?`,
      p_question_ar: "سوق اختباري؟",
      p_category: "politics",
      p_keywords: ["test"],
      p_liquidity_param: b,
      p_opens_at: new Date(Date.now() - 60_000).toISOString(),
      p_closes_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      p_opening_price: opening_price,
    });
    if (!error && data) {
      const row = data as { market_id: string };
      marketIds.push(row.market_id);
    }
    return { data, error };
  };

  // ---------------------------------------------------------------
  // 1. p = 0.5 → no seeding, current 50/50 behavior preserved
  // ---------------------------------------------------------------
  it("opening_price=0.5 creates a 50/50 market with zero seed shares", async () => {
    const { data, error } = await createMarket(0.5, 1000);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    const row = data as {
      market_id: string;
      opening_price: number;
      seed_q_yes: number;
      seed_q_no: number;
    };
    expect(Number(row.seed_q_yes)).toBeCloseTo(0, 4);
    expect(Number(row.seed_q_no)).toBeCloseTo(0, 4);

    const { data: amm } = await serviceClient
      .from("amm_state")
      .select("q_yes, q_no, current_yes_price, current_no_price, retail_shares_yes, retail_shares_no, retail_net_cash")
      .eq("market_id", row.market_id)
      .single();
    expect(amm).not.toBeNull();
    expect(Number(amm!.q_yes)).toBeCloseTo(0, 4);
    expect(Number(amm!.q_no)).toBeCloseTo(0, 4);
    expect(Number(amm!.current_yes_price)).toBeCloseTo(0.5, 3);
    expect(Number(amm!.current_no_price)).toBeCloseTo(0.5, 3);
  });

  // ---------------------------------------------------------------
  // 2. p = 0.7 (YES-leaning) → seeds q_yes only, initial price = 0.7
  // ---------------------------------------------------------------
  it("opening_price=0.7 seeds ~847 YES shares, initial price = 0.7", async () => {
    const b = 1000;
    const { data, error } = await createMarket(0.7, b);
    expect(error).toBeNull();
    const row = data as { market_id: string; seed_q_yes: number; seed_q_no: number };
    const expectedQYes = b * Math.log(0.7 / 0.3);
    expect(Number(row.seed_q_yes)).toBeCloseTo(expectedQYes, 1);
    expect(Number(row.seed_q_no)).toBeCloseTo(0, 4);

    const { data: amm } = await serviceClient
      .from("amm_state")
      .select("q_yes, q_no, current_yes_price")
      .eq("market_id", row.market_id)
      .single();
    expect(Number(amm!.q_yes)).toBeCloseTo(expectedQYes, 1);
    expect(Number(amm!.current_yes_price)).toBeCloseTo(0.7, 3);
  });

  // ---------------------------------------------------------------
  // 3. p = 0.3 (NO-leaning) → seeds q_no only, initial price = 0.3
  // ---------------------------------------------------------------
  it("opening_price=0.3 seeds ~847 NO shares, initial price = 0.3", async () => {
    const b = 1000;
    const { data, error } = await createMarket(0.3, b);
    expect(error).toBeNull();
    const row = data as { market_id: string; seed_q_yes: number; seed_q_no: number };
    const expectedQNo = b * Math.log(0.7 / 0.3);
    expect(Number(row.seed_q_yes)).toBeCloseTo(0, 4);
    expect(Number(row.seed_q_no)).toBeCloseTo(expectedQNo, 1);

    const { data: amm } = await serviceClient
      .from("amm_state")
      .select("q_yes, q_no, current_yes_price")
      .eq("market_id", row.market_id)
      .single();
    expect(Number(amm!.q_no)).toBeCloseTo(expectedQNo, 1);
    expect(Number(amm!.current_yes_price)).toBeCloseTo(0.3, 3);
  });

  // ---------------------------------------------------------------
  // 4. Edge: p = 0.05 (5% YES)
  // ---------------------------------------------------------------
  it("opening_price=0.05 accepted, initial YES price = 0.05", async () => {
    const { data, error } = await createMarket(0.05, 1000);
    expect(error).toBeNull();
    const row = data as { market_id: string };
    const { data: amm } = await serviceClient
      .from("amm_state")
      .select("current_yes_price")
      .eq("market_id", row.market_id)
      .single();
    expect(Number(amm!.current_yes_price)).toBeCloseTo(0.05, 3);
  });

  // ---------------------------------------------------------------
  // 5. Edge: p = 0.95 (95% YES)
  // ---------------------------------------------------------------
  it("opening_price=0.95 accepted, initial YES price = 0.95", async () => {
    const { data, error } = await createMarket(0.95, 1000);
    expect(error).toBeNull();
    const row = data as { market_id: string };
    const { data: amm } = await serviceClient
      .from("amm_state")
      .select("current_yes_price")
      .eq("market_id", row.market_id)
      .single();
    expect(Number(amm!.current_yes_price)).toBeCloseTo(0.95, 3);
  });

  // ---------------------------------------------------------------
  // 6. Rejection: p = 0.04 (too low)
  // ---------------------------------------------------------------
  it("opening_price=0.04 rejected with clear error", async () => {
    const { error } = await createMarket(0.04, 1000);
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/opening_price|between 0.05 and 0.95/i);
  });

  // ---------------------------------------------------------------
  // 7. Rejection: p = 0.96 (too high)
  // ---------------------------------------------------------------
  it("opening_price=0.96 rejected with clear error", async () => {
    const { error } = await createMarket(0.96, 1000);
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/opening_price|between 0.05 and 0.95/i);
  });

  // ---------------------------------------------------------------
  // 8. Retail columns stay at 0 after creation (seed shares are operator inventory)
  // ---------------------------------------------------------------
  it("retail columns stay at 0 after creation regardless of opening_price", async () => {
    const { data } = await createMarket(0.8, 1000);
    const row = data as { market_id: string };
    const { data: amm } = await serviceClient
      .from("amm_state")
      .select("retail_shares_yes, retail_shares_no, retail_net_cash, q_yes")
      .eq("market_id", row.market_id)
      .single();
    expect(Number(amm!.retail_shares_yes)).toBe(0);
    expect(Number(amm!.retail_shares_no)).toBe(0);
    expect(Number(amm!.retail_net_cash)).toBe(0);
    // But q_yes (total pool) should have the seed shares
    expect(Number(amm!.q_yes)).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------
  // 9. Subsequent execute_trade still works on a seeded market
  // ---------------------------------------------------------------
  it("execute_trade works after market is created with non-default opening_price", async () => {
    const { data } = await createMarket(0.7, 1000);
    const row = data as { market_id: string };

    const trader = await createAuthenticatedClient(serviceClient, { balance_usd: 500 });
    userIds.push(trader.userId);
    authCleanups.push(trader.cleanup);

    const { error: tradeError } = await trader.client.rpc("execute_trade", {
      p_market_id: row.market_id,
      p_side: "yes",
      p_amount: 20,
    });
    expect(tradeError).toBeNull();

    const { data: amm } = await serviceClient
      .from("amm_state")
      .select("retail_shares_yes, retail_net_cash, current_yes_price")
      .eq("market_id", row.market_id)
      .single();
    // Retail YES shares grew (from 0), retail cash grew, price moved up from 0.7
    expect(Number(amm!.retail_shares_yes)).toBeGreaterThan(0);
    expect(Number(amm!.retail_net_cash)).toBeGreaterThan(0);
    expect(Number(amm!.current_yes_price)).toBeGreaterThan(0.7);
  });
});
