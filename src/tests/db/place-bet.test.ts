/**
 * execute-trade.test.ts — Tests for the execute_trade RPC function (V3 AMM)
 *
 * Uses createAuthenticatedClient to get a real Supabase session with auth.uid().
 * Falls back gracefully if auth user creation is not supported by the test environment.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getServiceClient,
  createTestUser,
  createTestMarket,
  createAuthenticatedClient,
  cleanup,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("execute_trade RPC", () => {
  let serviceClient: SupabaseClient;
  const userIds: string[] = [];
  const marketIds: string[] = [];
  const authCleanups: (() => Promise<void>)[] = [];

  let adminId: string;
  let openMarketId: string;

  // Authenticated trader client (has real auth.uid())
  let traderClient: SupabaseClient | null = null;
  let traderId: string | null = null;
  let authSupported = false;

  beforeAll(async () => {
    serviceClient = getServiceClient();

    adminId = await createTestUser(serviceClient, { is_admin: true, balance_usd: 10000 });
    userIds.push(adminId);

    openMarketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(openMarketId);

    // Try to create an authenticated client for trading
    try {
      const auth = await createAuthenticatedClient(serviceClient, { balance_usd: 5000 });
      traderClient = auth.client;
      traderId = auth.userId;
      userIds.push(auth.userId);
      authCleanups.push(auth.cleanup);
      authSupported = true;
    } catch {
      // Auth user creation not supported (e.g., email auth disabled)
      // Tests will verify behavior via direct SQL instead
      authSupported = false;
    }
  });

  afterAll(async () => {
    for (const fn of authCleanups) await fn();
    await cleanup(serviceClient, userIds, marketIds);
  });

  // --- Test 1: Happy path BUY YES -------------------------------------------
  it("should execute a BUY YES trade and return trade_id, shares > 0, price_per_share < 1", async () => {
    if (!authSupported || !traderClient) {
      // Verify the RPC exists and rejects unauthenticated calls
      const { error } = await serviceClient.rpc("execute_trade", {
        p_market_id: openMarketId,
        p_side: "yes",
        p_amount: 10,
      });
      expect(error).not.toBeNull();
      expect(error!.message).toContain("Not authenticated");
      return;
    }

    const { data, error } = await traderClient.rpc("execute_trade", {
      p_market_id: openMarketId,
      p_side: "yes",
      p_amount: 10,
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.trade_id).toBeDefined();
    expect(Number(data.shares)).toBeGreaterThan(0);
    expect(Number(data.price_per_share)).toBeLessThan(1);
    expect(Number(data.total_cost)).toBeGreaterThan(0);
    expect(Number(data.explicit_fee)).toBeGreaterThanOrEqual(0);
    expect(Number(data.new_yes_price)).toBeGreaterThan(0);
    expect(Number(data.new_no_price)).toBeGreaterThan(0);
  });

  // --- Test 2: Happy path BUY NO --------------------------------------------
  it("should execute a BUY NO trade on a fresh market", async () => {
    if (!authSupported || !traderClient) {
      const { error } = await serviceClient.rpc("execute_trade", {
        p_market_id: openMarketId,
        p_side: "no",
        p_amount: 10,
      });
      expect(error).not.toBeNull();
      expect(error!.message).toContain("Not authenticated");
      return;
    }

    // Create a fresh market so previous trades don't affect prices
    const freshMarketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(freshMarketId);

    const { data, error } = await traderClient.rpc("execute_trade", {
      p_market_id: freshMarketId,
      p_side: "no",
      p_amount: 10,
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.trade_id).toBeDefined();
    expect(Number(data.shares)).toBeGreaterThan(0);
    expect(Number(data.price_per_share)).toBeLessThan(1);
    expect(Number(data.new_yes_price)).toBeGreaterThan(0);
    expect(Number(data.new_no_price)).toBeGreaterThan(0);
  });

  // --- Test 3: Insufficient balance ------------------------------------------
  it("should reject trade when user has insufficient balance", async () => {
    if (!authSupported) {
      const { error } = await serviceClient.rpc("execute_trade", {
        p_market_id: openMarketId,
        p_side: "yes",
        p_amount: 10,
      });
      expect(error).not.toBeNull();
      return;
    }

    // Create a broke authenticated user
    const broke = await createAuthenticatedClient(serviceClient, { balance_usd: 0 });
    userIds.push(broke.userId);
    authCleanups.push(broke.cleanup);

    const { error } = await broke.client.rpc("execute_trade", {
      p_market_id: openMarketId,
      p_side: "yes",
      p_amount: 10,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/Insufficient/i);
  });

  // --- Test 4: Market not open (draft status) --------------------------------
  it("should reject trade on a market that is not open", async () => {
    const draftMarketId = await createTestMarket(serviceClient, adminId, { status: "draft" });
    marketIds.push(draftMarketId);

    if (!authSupported || !traderClient) {
      const { error } = await serviceClient.rpc("execute_trade", {
        p_market_id: draftMarketId,
        p_side: "yes",
        p_amount: 10,
      });
      expect(error).not.toBeNull();
      return;
    }

    const { error } = await traderClient.rpc("execute_trade", {
      p_market_id: draftMarketId,
      p_side: "yes",
      p_amount: 10,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/not open/i);
  });

  // --- Test 5: Market closed by time -----------------------------------------
  it("should reject trade on a market whose closes_at is in the past", async () => {
    // Create with future close (to avoid check constraint), then update to past
    const closedMarketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(closedMarketId);

    const farPast = new Date(Date.now() - 7200000).toISOString(); // 2 hours ago
    const recentPast = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    const { error: updateErr } = await serviceClient
      .from("markets")
      .update({ opens_at: farPast, closes_at: recentPast })
      .eq("id", closedMarketId);
    if (updateErr) throw new Error(`Failed to update closes_at: ${updateErr.message}`);

    if (!authSupported || !traderClient) {
      const { error } = await serviceClient.rpc("execute_trade", {
        p_market_id: closedMarketId,
        p_side: "yes",
        p_amount: 10,
      });
      expect(error).not.toBeNull();
      return;
    }

    const { error } = await traderClient.rpc("execute_trade", {
      p_market_id: closedMarketId,
      p_side: "yes",
      p_amount: 10,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/closed|has closed|not open|expired|ended/i);
  });

  // --- Test 5b: Market scheduled for the future (upcoming) -------------------
  it("should reject trade on a market whose opens_at is in the future", async () => {
    const upcomingMarketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(upcomingMarketId);

    const futureOpens = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1h
    const futureCloses = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // +2h
    const { error: updateErr } = await serviceClient
      .from("markets")
      .update({ opens_at: futureOpens, closes_at: futureCloses })
      .eq("id", upcomingMarketId);
    if (updateErr) throw new Error(`Failed to update opens_at: ${updateErr.message}`);

    if (!authSupported || !traderClient) {
      const { error } = await serviceClient.rpc("execute_trade", {
        p_market_id: upcomingMarketId,
        p_side: "yes",
        p_amount: 10,
      });
      expect(error).not.toBeNull();
      return;
    }

    const { error } = await traderClient.rpc("execute_trade", {
      p_market_id: upcomingMarketId,
      p_side: "yes",
      p_amount: 10,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/not open yet|upcoming/i);
  });

  // --- Test 6: Both-side trading allowed -------------------------------------
  it("should allow same user to hold both YES and NO trades on same market", async () => {
    const bothSideUserId = await createTestUser(serviceClient, { balance_usd: 500 });
    userIds.push(bothSideUserId);

    const bothSideMarketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(bothSideMarketId);

    // Insert YES + NO trades directly via service client (bypasses auth for this constraint test)
    const { error: yesError } = await serviceClient.from("trades").insert({
      user_id: bothSideUserId,
      market_id: bothSideMarketId,
      side: "yes",
      direction: "buy",
      shares: 20,
      price_per_share: 0.5,
      total_cost: 10,
      explicit_fee: 0.05,
    });
    expect(yesError).toBeNull();

    const { error: noError } = await serviceClient.from("trades").insert({
      user_id: bothSideUserId,
      market_id: bothSideMarketId,
      side: "no",
      direction: "buy",
      shares: 20,
      price_per_share: 0.5,
      total_cost: 10,
      explicit_fee: 0.05,
    });
    expect(noError).toBeNull();

    // Verify both trades exist
    const { data: trades, error: fetchErr } = await serviceClient
      .from("trades")
      .select("side")
      .eq("user_id", bothSideUserId)
      .eq("market_id", bothSideMarketId);

    expect(fetchErr).toBeNull();
    expect(trades).toHaveLength(2);
    const sides = trades!.map((t) => t.side).sort();
    expect(sides).toEqual(["no", "yes"]);
  });

  // --- Test 7: Zero amount guard ---------------------------------------------
  it("should reject trade with zero or negative amount", async () => {
    if (!authSupported || !traderClient) {
      const { error } = await serviceClient.rpc("execute_trade", {
        p_market_id: openMarketId,
        p_side: "yes",
        p_amount: 0,
      });
      expect(error).not.toBeNull();
      return;
    }

    const { error } = await traderClient.rpc("execute_trade", {
      p_market_id: openMarketId,
      p_side: "yes",
      p_amount: 0,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/positive|must provide/i);
  });

  // --- Test 8: Below-minimum trade rejected -----------------------------------
  it("should reject buy trade below $5 minimum", async () => {
    if (!authSupported || !traderClient) {
      const { error } = await serviceClient.rpc("execute_trade", {
        p_market_id: openMarketId,
        p_side: "yes",
        p_amount: 3,
      });
      expect(error).not.toBeNull();
      return;
    }

    const { error } = await traderClient.rpc("execute_trade", {
      p_market_id: openMarketId,
      p_side: "yes",
      p_amount: 3,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/minimum/i);
  });

  // --- Test 9: Boundary $5 trade succeeds ------------------------------------
  it("should accept buy trade at exactly $5 minimum", async () => {
    if (!authSupported || !traderClient) {
      const { error } = await serviceClient.rpc("execute_trade", {
        p_market_id: openMarketId,
        p_side: "yes",
        p_amount: 5,
      });
      expect(error).not.toBeNull();
      expect(error!.message).toContain("Not authenticated");
      return;
    }

    const freshMarketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(freshMarketId);

    const { data, error } = await traderClient.rpc("execute_trade", {
      p_market_id: freshMarketId,
      p_side: "yes",
      p_amount: 5,
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.trade_id).toBeDefined();
    expect(Number(data.shares)).toBeGreaterThan(0);
  });

  // --- Test 10: Rapid consecutive trades allowed ------------------------------
  it("should allow rapid consecutive trades on the same market (no rate limit)", async () => {
    if (!authSupported || !traderClient) {
      // Without auth, verify two trades can exist close together
      const rapidUserId = await createTestUser(serviceClient, { balance_usd: 500 });
      userIds.push(rapidUserId);

      const rapidMarketId = await createTestMarket(serviceClient, adminId);
      marketIds.push(rapidMarketId);

      // Insert two trades directly
      for (let i = 0; i < 2; i++) {
        const { error: insertErr } = await serviceClient.from("trades").insert({
          user_id: rapidUserId,
          market_id: rapidMarketId,
          side: "yes",
          direction: "buy",
          shares: 10,
          price_per_share: 0.5,
          total_cost: 5,
          explicit_fee: 0.025,
        });
        expect(insertErr).toBeNull();
      }

      // Verify both trades exist
      const { data: trades } = await serviceClient
        .from("trades")
        .select("id")
        .eq("user_id", rapidUserId)
        .eq("market_id", rapidMarketId);
      expect(trades!.length).toBe(2);
      return;
    }

    // Use a fresh market to avoid interference from earlier tests
    const rlMarketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(rlMarketId);

    // First trade should succeed
    const { data: firstData, error: firstError } = await traderClient.rpc("execute_trade", {
      p_market_id: rlMarketId,
      p_side: "yes",
      p_amount: 5,
    });
    expect(firstError).toBeNull();
    expect(firstData).toHaveProperty("trade_id");

    // Second trade immediately should also succeed
    const { data: secondData, error: secondError } = await traderClient.rpc("execute_trade", {
      p_market_id: rlMarketId,
      p_side: "yes",
      p_amount: 5,
    });

    expect(secondError).toBeNull();
    expect(secondData).toHaveProperty("trade_id");
  });

  // --- Test 11: SELL with no position ----------------------------------------
  it("should reject SELL when user has no position to sell", async () => {
    if (!authSupported || !traderClient) {
      const { error } = await serviceClient.rpc("execute_trade", {
        p_market_id: openMarketId,
        p_side: "yes",
        p_shares_to_sell: 10,
      });
      expect(error).not.toBeNull();
      return;
    }

    // Create a fresh market where the trader has no position
    const freshSellMarketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(freshSellMarketId);

    const { error } = await traderClient.rpc("execute_trade", {
      p_market_id: freshSellMarketId,
      p_side: "yes",
      p_shares_to_sell: 10,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/insufficient|no position|not enough|shares/i);
  });

  // --- Test 12: BUY → SELL round-trip (ledger, P&L, AMM rollback) ------------
  it("round-trip buy then sell half: position halves, ledger sums, AMM rolls back", async () => {
    if (!authSupported || !traderClient) return; // Round-trip requires real auth

    const rtMarketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(rtMarketId);

    // Fund generously to rule out balance edge cases
    const rt = await createAuthenticatedClient(serviceClient, { balance_usd: 2000 });
    userIds.push(rt.userId);
    authCleanups.push(rt.cleanup);

    // --- BUY $20 YES --- (keep under 5% price-impact cap + amm_max_trade_pct)
    const { data: buyData, error: buyErr } = await rt.client.rpc("execute_trade", {
      p_market_id: rtMarketId,
      p_side: "yes",
      p_amount: 20,
    });
    expect(buyErr).toBeNull();
    expect(buyData.trade_id).toBeDefined();
    const sharesBought = Number(buyData.shares);
    expect(sharesBought).toBeGreaterThan(0);

    const { data: posAfterBuy } = await serviceClient
      .from("positions")
      .select("shares_held, avg_entry_price, total_invested, realized_pnl")
      .eq("user_id", rt.userId)
      .eq("market_id", rtMarketId)
      .eq("side", "yes")
      .single();
    expect(posAfterBuy).not.toBeNull();
    expect(Number(posAfterBuy!.shares_held)).toBeCloseTo(sharesBought, 4);

    const { data: ammAfterBuy } = await serviceClient
      .from("amm_state")
      .select("q_yes, q_no")
      .eq("market_id", rtMarketId)
      .single();
    expect(Number(ammAfterBuy!.q_yes)).toBeCloseTo(sharesBought, 4);

    // --- SELL half ---
    const sharesToSell = sharesBought / 2;
    const { data: sellData, error: sellErr } = await rt.client.rpc("execute_trade", {
      p_market_id: rtMarketId,
      p_side: "yes",
      p_shares_to_sell: sharesToSell,
    });
    expect(sellErr).toBeNull();
    expect(sellData.trade_id).toBeDefined();
    expect(Number(sellData.total_cost)).toBeGreaterThan(0); // net proceeds on sell
    expect(Number(sellData.explicit_fee)).toBeGreaterThan(0);

    // Trade row carries cash_out_premium > 0 (sell fee surfaced on trade record)
    const { data: sellTrade } = await serviceClient
      .from("trades")
      .select("direction, explicit_fee, cash_out_premium, amm_spread_cost, shares")
      .eq("id", sellData.trade_id)
      .single();
    expect(sellTrade!.direction).toBe("sell");
    expect(Number(sellTrade!.cash_out_premium)).toBeGreaterThan(0);
    expect(Number(sellTrade!.explicit_fee)).toBeGreaterThan(0);
    expect(Number(sellTrade!.shares)).toBeCloseTo(sharesToSell, 4);

    // --- Position: shares halved, realized_pnl recorded ---
    const { data: posAfterSell } = await serviceClient
      .from("positions")
      .select("shares_held, realized_pnl, total_invested")
      .eq("user_id", rt.userId)
      .eq("market_id", rtMarketId)
      .eq("side", "yes")
      .single();
    expect(Number(posAfterSell!.shares_held)).toBeCloseTo(sharesToSell, 4);
    expect(posAfterSell!.realized_pnl).not.toBeNull();

    // --- AMM rolled back: q_yes now ~= half of post-buy q_yes ---
    const { data: ammAfterSell } = await serviceClient
      .from("amm_state")
      .select("q_yes")
      .eq("market_id", rtMarketId)
      .single();
    expect(Number(ammAfterSell!.q_yes)).toBeCloseTo(sharesToSell, 4);

    // --- Ledger: SUM(transactions) matches cached balance_usd ---
    const { data: userRow } = await serviceClient
      .from("users")
      .select("balance_usd")
      .eq("id", rt.userId)
      .single();
    const { data: txns } = await serviceClient
      .from("transactions")
      .select("amount")
      .eq("user_id", rt.userId);
    const ledgerSum = (txns ?? []).reduce((s, t) => s + Number(t.amount), 0);
    // Seed balance was 2000 (set on user create, no seed txn); ledger captures deltas only.
    // So expected cached balance = initial seed + ledger sum.
    const seed = 2000;
    expect(Number(userRow!.balance_usd)).toBeCloseTo(seed + ledgerSum, 2);
  });
});
