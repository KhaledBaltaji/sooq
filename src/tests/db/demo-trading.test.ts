/**
 * demo-trading.test.ts — tests for demo_execute_trade RPC
 *
 * Pure LMSR trading with zero fees / commissions / revenue. Critical assertions:
 * live tables (transactions, positions, trades, etc.) must NEVER grow as a
 * result of demo activity.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getServiceClient,
  createAuthenticatedClient,
  createTestDemoMarket,
  enableDemoMode,
  cleanup,
  cleanupDemo,
  assertZeroLiveWrites,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("demo_execute_trade RPC", () => {
  let serviceClient: SupabaseClient;
  const userIds: string[] = [];
  const demoMarketIds: string[] = [];
  const authCleanups: (() => Promise<void>)[] = [];

  let adminId: string;

  beforeAll(async () => {
    serviceClient = getServiceClient();
    const admin = await createAuthenticatedClient(serviceClient, {
      is_admin: true,
      balance_usd: 10000,
    });
    adminId = admin.userId;
    userIds.push(adminId);
    authCleanups.push(admin.cleanup);
  });

  afterAll(async () => {
    for (const fn of authCleanups) await fn();
    await cleanupDemo(serviceClient, userIds, demoMarketIds);
    await cleanup(serviceClient, userIds);
  });

  it("buy updates demo balance + demo_amm_state, zero writes to live tables", async () => {
    const auth = await createAuthenticatedClient(serviceClient, { balance_usd: 500 });
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);
    await enableDemoMode(auth.client);

    const marketId = await createTestDemoMarket(serviceClient, adminId);
    demoMarketIds.push(marketId);

    await assertZeroLiveWrites(serviceClient, auth.userId, async () => {
      const { data, error } = await auth.client.rpc("demo_execute_trade", {
        p_market_id: marketId,
        p_side: "yes",
        p_amount: 100,
      });
      expect(error).toBeNull();
      expect(data.trade_id).toBeDefined();
      expect(Number(data.shares)).toBeGreaterThan(0);
    });

    // Demo balance should have decreased by $100
    const { data: userRow } = await serviceClient
      .from("users")
      .select("demo_balance_usd")
      .eq("id", auth.userId)
      .single();
    expect(Number(userRow!.demo_balance_usd)).toBe(9900);

    // demo_amm_state should have q_yes > 0
    const { data: amm } = await serviceClient
      .from("demo_amm_state")
      .select("q_yes, q_no, total_trades")
      .eq("market_id", marketId)
      .single();
    expect(Number(amm!.q_yes)).toBeGreaterThan(0);
    expect(amm!.total_trades).toBe(1);
  });

  it("sell returns shares and credits demo balance", async () => {
    const auth = await createAuthenticatedClient(serviceClient, { balance_usd: 0 });
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);
    await enableDemoMode(auth.client);

    const marketId = await createTestDemoMarket(serviceClient, adminId);
    demoMarketIds.push(marketId);

    // First buy
    await auth.client.rpc("demo_execute_trade", {
      p_market_id: marketId,
      p_side: "yes",
      p_amount: 200,
    });

    const { data: afterBuy } = await serviceClient
      .from("users")
      .select("demo_balance_usd")
      .eq("id", auth.userId)
      .single();

    const { data: pos } = await serviceClient
      .from("demo_positions")
      .select("shares_held")
      .eq("user_id", auth.userId)
      .eq("market_id", marketId)
      .eq("side", "yes")
      .single();

    // Sell half
    const sharesToSell = Number(pos!.shares_held) * 0.5;
    const { error } = await auth.client.rpc("demo_execute_trade", {
      p_market_id: marketId,
      p_side: "yes",
      p_shares_to_sell: sharesToSell,
    });
    expect(error).toBeNull();

    const { data: afterSell } = await serviceClient
      .from("users")
      .select("demo_balance_usd")
      .eq("id", auth.userId)
      .single();
    expect(Number(afterSell!.demo_balance_usd)).toBeGreaterThan(
      Number(afterBuy!.demo_balance_usd)
    );
  });

  it("insufficient demo balance rejects", async () => {
    const auth = await createAuthenticatedClient(serviceClient);
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);
    await enableDemoMode(auth.client);

    const marketId = await createTestDemoMarket(serviceClient, adminId);
    demoMarketIds.push(marketId);

    const { error } = await auth.client.rpc("demo_execute_trade", {
      p_market_id: marketId,
      p_side: "yes",
      p_amount: 50000,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/insufficient/i);
  });

  it("trade on closed demo market rejects", async () => {
    const auth = await createAuthenticatedClient(serviceClient);
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);
    await enableDemoMode(auth.client);

    const marketId = await createTestDemoMarket(serviceClient, adminId, {
      status: "closed",
    });
    demoMarketIds.push(marketId);

    const { error } = await auth.client.rpc("demo_execute_trade", {
      p_market_id: marketId,
      p_side: "yes",
      p_amount: 50,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/not open|closed/i);
  });

  it("demo_first_trade_at is set on first trade, idempotent on subsequent", async () => {
    const auth = await createAuthenticatedClient(serviceClient);
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);
    await enableDemoMode(auth.client);

    const marketId = await createTestDemoMarket(serviceClient, adminId);
    demoMarketIds.push(marketId);

    const { data: before } = await serviceClient
      .from("users")
      .select("demo_first_trade_at")
      .eq("id", auth.userId)
      .single();
    expect(before!.demo_first_trade_at).toBeNull();

    await auth.client.rpc("demo_execute_trade", {
      p_market_id: marketId,
      p_side: "yes",
      p_amount: 50,
    });

    const { data: afterFirst } = await serviceClient
      .from("users")
      .select("demo_first_trade_at")
      .eq("id", auth.userId)
      .single();
    expect(afterFirst!.demo_first_trade_at).not.toBeNull();

    const firstTradeTime = afterFirst!.demo_first_trade_at;

    await auth.client.rpc("demo_execute_trade", {
      p_market_id: marketId,
      p_side: "yes",
      p_amount: 50,
    });

    const { data: afterSecond } = await serviceClient
      .from("users")
      .select("demo_first_trade_at")
      .eq("id", auth.userId)
      .single();
    // Idempotent — value should not be updated on subsequent trades
    expect(afterSecond!.demo_first_trade_at).toBe(firstTradeTime);
  });

  it("avg_entry_price recalculates across multiple buys", async () => {
    const auth = await createAuthenticatedClient(serviceClient);
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);
    await enableDemoMode(auth.client);

    const marketId = await createTestDemoMarket(serviceClient, adminId);
    demoMarketIds.push(marketId);

    await auth.client.rpc("demo_execute_trade", {
      p_market_id: marketId,
      p_side: "yes",
      p_amount: 100,
    });
    await auth.client.rpc("demo_execute_trade", {
      p_market_id: marketId,
      p_side: "yes",
      p_amount: 100,
    });

    const { data: pos } = await serviceClient
      .from("demo_positions")
      .select("shares_held, total_invested, avg_entry_price")
      .eq("user_id", auth.userId)
      .eq("market_id", marketId)
      .eq("side", "yes")
      .single();

    expect(Number(pos!.total_invested)).toBe(200);
    // avg_entry_price should match total_invested / shares_held
    const expected = Number(pos!.total_invested) / Number(pos!.shares_held);
    expect(Math.abs(Number(pos!.avg_entry_price) - expected)).toBeLessThan(0.0001);
  });
});
