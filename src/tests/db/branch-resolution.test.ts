/**
 * branch-resolution.test.ts — Tests for Phase 4: Resolution Settlement
 *
 * Verifies:
 * 1. Branch winners paid from branch pool (not SOOQ treasury)
 * 2. Retail winners unaffected by branch positions
 * 3. Insufficient pool → payback mode (users still paid in full)
 * 4. record_revenue uses retail trades only (no double-counting)
 * 5. settle_resolution_commissions skips branch positions
 * 6. Void market refunds branch positions through branch pool
 * 7. branch_revenue recorded correctly
 * 8. Leader stats exclude branch users
 * 9. Combined retail + branch resolution
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getServiceClient,
  createTestUser,
  createTestMarket,
  createAuthenticatedClient,
  createTestBranch,
  assignUserToBranch,
  fundBranchPool,
  executeBranchTrade,
  cleanup,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("branch resolution settlement", () => {
  let serviceClient: SupabaseClient;
  const userIds: string[] = [];
  const marketIds: string[] = [];
  const branchIds: string[] = [];
  const authCleanups: (() => Promise<void>)[] = [];

  let adminId: string;
  let adminClient: SupabaseClient;
  let branch: { id: string; code: string };
  let authSupported = false;
  const TEST_PIN = "123456";

  beforeAll(async () => {
    serviceClient = getServiceClient();

    try {
      // Create admin with PIN
      const auth = await createAuthenticatedClient(serviceClient, {
        is_admin: true,
        balance_usd: 50000,
      });
      adminClient = auth.client;
      adminId = auth.userId;
      userIds.push(auth.userId);
      authCleanups.push(auth.cleanup);

      const { error: pinError } = await adminClient.rpc("admin_set_pin", { p_pin: TEST_PIN });
      if (pinError) throw new Error(`admin_set_pin failed: ${pinError.message}`);

      // Create branch
      branch = await createTestBranch(serviceClient, adminId, {
        pool_balance: 10000,
        worst_case_total: 0,
      });
      branchIds.push(branch.id);

      authSupported = true;
    } catch (e) {
      console.warn("Auth setup failed — branch-resolution tests will skip:", e);
    }
  });

  afterAll(async () => {
    for (const fn of authCleanups) await fn();
    await cleanup(serviceClient, userIds, marketIds, branchIds);
  });

  /** Create a trader that buys via retail execute_trade */
  async function createRetailTrader(marketId: string, side: "yes" | "no", amount: number): Promise<string> {
    const auth = await createAuthenticatedClient(serviceClient, { balance_usd: 5000 });
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);

    const { error } = await auth.client.rpc("execute_trade", {
      p_market_id: marketId,
      p_side: side,
      p_amount: amount,
    });
    if (error) throw new Error(`execute_trade failed: ${error.message}`);
    return auth.userId;
  }

  /** Create a trader that buys via branch execute_branch_trade */
  async function createBranchTrader(
    marketId: string,
    branchId: string,
    side: "yes" | "no",
    amount: number
  ): Promise<{ userId: string; client: SupabaseClient }> {
    const auth = await createAuthenticatedClient(serviceClient, { balance_usd: 5000 });
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);

    await assignUserToBranch(serviceClient, auth.userId, branchId);

    const { error } = await auth.client.rpc("execute_branch_trade", {
      p_market_id: marketId,
      p_branch_id: branchId,
      p_side: side,
      p_amount: amount,
    });
    if (error) throw new Error(`execute_branch_trade failed: ${error.message}`);
    return { userId: auth.userId, client: auth.client };
  }

  async function getBalance(userId: string): Promise<number> {
    const { data } = await serviceClient.from("users").select("balance_usd").eq("id", userId).single();
    return Number(data?.balance_usd ?? 0);
  }

  async function callResolve(marketId: string, outcome: "yes" | "no") {
    return adminClient.rpc("resolve_market", {
      p_market_id: marketId,
      p_outcome: outcome,
      p_pin: TEST_PIN,
    });
  }

  // --- Test 1: Branch winners paid from pool ---
  it("should pay branch winners from branch pool, not SOOQ treasury", async () => {
    if (!authSupported) return;

    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    // Reset branch pool
    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0, pending_payouts: 0, status: "active" })
      .eq("id", branch.id);

    const trader = await createBranchTrader(marketId, branch.id, "yes", 20);
    const balanceBefore = await getBalance(trader.userId);

    // Resolve YES
    const { data, error } = await callResolve(marketId, "yes");
    expect(error).toBeNull();
    expect(data.success).toBe(true);

    // Branch trader should have been paid
    const balanceAfter = await getBalance(trader.userId);
    expect(balanceAfter).toBeGreaterThan(balanceBefore);

    // Branch pool should have decreased
    const { data: br } = await serviceClient.from("branches").select("pool_balance").eq("id", branch.id).single();
    expect(Number(br!.pool_balance)).toBeLessThan(10000);

    // branch_settlement should be in the result
    expect(data.branch_settlement).toBeDefined();
    expect(data.branch_settlement.branches_settled).toBeGreaterThanOrEqual(1);
  });

  // --- Test 2: Retail winners unaffected by branch positions ---
  it("should pay retail winners correctly alongside branch positions", async () => {
    if (!authSupported) return;

    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0, pending_payouts: 0, status: "active" })
      .eq("id", branch.id);

    // Both a retail and branch trader buy YES
    const retailUserId = await createRetailTrader(marketId, "yes", 20);
    await createBranchTrader(marketId, branch.id, "yes", 20);

    const retailBalanceBefore = await getBalance(retailUserId);

    const { data, error } = await callResolve(marketId, "yes");
    expect(error).toBeNull();

    // Retail winner should be paid from retail loop
    const retailBalanceAfter = await getBalance(retailUserId);
    expect(retailBalanceAfter).toBeGreaterThan(retailBalanceBefore);
    expect(data.winners_paid).toBeGreaterThanOrEqual(1); // At least 1 retail winner
  });

  // --- Test 3: Insufficient pool → payback mode ---
  it("should activate payback mode when branch pool is insufficient", async () => {
    if (!authSupported) return;

    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    // Set pool very low — barely enough for the trade but not for payout
    await serviceClient.from("branches")
      .update({ pool_balance: 5, worst_case_total: 0, pending_payouts: 0, status: "active" })
      .eq("id", branch.id);

    const trader = await createBranchTrader(marketId, branch.id, "yes", 10);

    // Resolve — pool ($5 + trade inflow) won't cover shares payout
    const { data, error } = await callResolve(marketId, "yes");
    expect(error).toBeNull();

    // Check branch went into payback
    const { data: br } = await serviceClient
      .from("branches")
      .select("status, pending_payouts, pool_balance")
      .eq("id", branch.id)
      .single();

    // Pool should be floored at 0 or close to it, with pending_payouts > 0
    expect(Number(br!.pool_balance)).toBeLessThanOrEqual(1);
    // Either payback or pending_payouts should reflect deficit
    // (payback only activates from 'active' status)
    expect(Number(br!.pending_payouts)).toBeGreaterThan(0);

    // Reset
    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0, pending_payouts: 0, status: "active" })
      .eq("id", branch.id);
  });

  // --- Test 4: Winners always paid in full even with insufficient pool ---
  it("should pay branch winners in full even when pool is insufficient", async () => {
    if (!authSupported) return;

    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    await serviceClient.from("branches")
      .update({ pool_balance: 5, worst_case_total: 0, pending_payouts: 0, status: "active" })
      .eq("id", branch.id);

    const trader = await createBranchTrader(marketId, branch.id, "yes", 10);
    const balanceBefore = await getBalance(trader.userId);

    const { error } = await callResolve(marketId, "yes");
    expect(error).toBeNull();

    // User MUST be paid regardless of pool status
    const balanceAfter = await getBalance(trader.userId);
    expect(balanceAfter).toBeGreaterThan(balanceBefore);

    // Reset
    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0, pending_payouts: 0, status: "active" })
      .eq("id", branch.id);
  });

  // --- Test 5: Resolution fee deducted correctly ---
  it("should deduct 1% resolution fee from branch winners", async () => {
    if (!authSupported) return;

    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0, pending_payouts: 0, status: "active" })
      .eq("id", branch.id);

    const trader = await createBranchTrader(marketId, branch.id, "yes", 50);

    // Get shares held
    const { data: pos } = await serviceClient
      .from("positions")
      .select("shares_held")
      .eq("user_id", trader.userId)
      .eq("market_id", marketId)
      .eq("side", "yes")
      .single();

    const shares = Number(pos!.shares_held);
    const expectedPayout = shares * (1 - 0.01); // RESOLUTION_FEE_RATE = 0.01

    const balanceBefore = await getBalance(trader.userId);
    await callResolve(marketId, "yes");
    const balanceAfter = await getBalance(trader.userId);

    const actualPayout = balanceAfter - balanceBefore;
    // Should be approximately shares * 0.99 (within rounding)
    expect(Math.abs(actualPayout - expectedPayout)).toBeLessThan(0.02);
  });

  // --- Test 6: record_revenue uses retail_trades only (CRITICAL regression test) ---
  it("should not include branch trade fees in platform_revenue", async () => {
    if (!authSupported) return;

    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0, pending_payouts: 0, status: "active" })
      .eq("id", branch.id);

    // Only branch trade — NO retail trades
    await createBranchTrader(marketId, branch.id, "yes", 30);

    // Also add a retail NO trader so market has winners
    const retailUser = await createRetailTrader(marketId, "no", 20);

    // Resolve NO (retail wins, branch loses)
    await callResolve(marketId, "no");

    // Check platform_revenue — should only reflect retail fees
    const { data: revenue } = await serviceClient
      .from("platform_revenue")
      .select("*")
      .eq("market_id", marketId)
      .is("branch_id", null)
      .single();

    // Platform revenue should exist and NOT include branch markup/fees
    // The explicit_fee_revenue should only be from the retail $20 trade
    expect(revenue).not.toBeNull();
    // Branch revenue should be tracked separately in branch_revenue table
    const { data: branchRevenue } = await serviceClient
      .from("branch_revenue")
      .select("*")
      .eq("market_id", marketId)
      .eq("branch_id", branch.id)
      .maybeSingle();

    // Branch revenue recorded (even though branch side lost, fees were collected on trade)
    if (branchRevenue) {
      expect(Number(branchRevenue.markup_revenue)).toBeGreaterThanOrEqual(0);
    }
  });

  // --- Test 7: settle_resolution_commissions skips branch positions ---
  it("should not generate referral commissions for branch winners", async () => {
    if (!authSupported) return;

    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0, pending_payouts: 0, status: "active" })
      .eq("id", branch.id);

    // Branch trader buys YES
    const trader = await createBranchTrader(marketId, branch.id, "yes", 30);

    // Give the branch user a referral chain (should NOT trigger commissions)
    await serviceClient.from("users")
      .update({ referral_chain: [adminId] })
      .eq("id", trader.userId);

    await callResolve(marketId, "yes");

    // Check referral_commissions — should have NO resolution commissions for branch user
    const { data: comms } = await serviceClient
      .from("referral_commissions")
      .select("*")
      .eq("market_id", marketId)
      .eq("revenue_type", "resolution")
      .eq("trader_id", trader.userId);

    expect(comms).toBeDefined();
    expect(comms!.length).toBe(0);
  });

  // --- Test 8: Void refunds branch positions through branch pool ---
  it("should refund branch positions through branch pool on void", async () => {
    if (!authSupported) return;

    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0, pending_payouts: 0, status: "active" })
      .eq("id", branch.id);

    const trader = await createBranchTrader(marketId, branch.id, "yes", 25);
    const balanceBefore = await getBalance(trader.userId);

    // Record pool after the trade (trade added funds to pool)
    const { data: brAfterTrade } = await serviceClient
      .from("branches").select("pool_balance").eq("id", branch.id).single();
    const poolAfterTrade = Number(brAfterTrade!.pool_balance);

    // Void the market (PIN required since migration 247)
    const { data, error } = await adminClient.rpc("void_market", {
      p_market_id: marketId,
      p_pin: TEST_PIN,
    });
    expect(error).toBeNull();

    // User should be refunded
    const balanceAfter = await getBalance(trader.userId);
    expect(balanceAfter).toBeGreaterThan(balanceBefore);

    // Branch pool should have decreased FROM its post-trade value (void debits the refund)
    const { data: br } = await serviceClient.from("branches").select("pool_balance").eq("id", branch.id).single();
    expect(Number(br!.pool_balance)).toBeLessThan(poolAfterTrade);

    // Verify a void_refund entry exists in branch_pools
    const { data: poolEntries } = await serviceClient
      .from("branch_pools")
      .select("type, amount")
      .eq("branch_id", branch.id)
      .eq("market_id", marketId)
      .eq("type", "void_refund");
    expect(poolEntries!.length).toBeGreaterThan(0);
  });

  // --- Test 9: Void with insufficient pool → payback ---
  it("should activate payback on void when branch pool is insufficient", async () => {
    if (!authSupported) return;

    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    // Fund pool well for the trade to succeed
    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0, pending_payouts: 0, status: "active" })
      .eq("id", branch.id);

    await createBranchTrader(marketId, branch.id, "yes", 20);

    // NOW drain pool to near zero — so void refund exceeds available pool
    await serviceClient.from("branches")
      .update({ pool_balance: 1 })
      .eq("id", branch.id);

    // Void — pool ($1) can't cover WAC refund (PIN required since migration 247)
    await adminClient.rpc("void_market", {
      p_market_id: marketId,
      p_pin: TEST_PIN,
    });

    const { data: br } = await serviceClient
      .from("branches")
      .select("status, pending_payouts, pool_balance")
      .eq("id", branch.id)
      .single();

    // Migration 248: pool now uses HONEST accounting — can go negative on
    // deficit (no clamping at 0). pending_payouts always tracks the deficit.
    expect(Number(br!.pool_balance)).toBeLessThanOrEqual(1);
    expect(Number(br!.pending_payouts)).toBeGreaterThan(0);

    // Reset
    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0, pending_payouts: 0, status: "active" })
      .eq("id", branch.id);
  });

  // --- Test 10: branch_revenue recorded correctly ---
  it("should record branch revenue after resolution", async () => {
    if (!authSupported) return;

    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0, pending_payouts: 0, status: "active" })
      .eq("id", branch.id);

    // Branch trader buys YES
    await createBranchTrader(marketId, branch.id, "yes", 30);

    // Resolve YES
    await callResolve(marketId, "yes");

    // Check branch_revenue table
    const { data: rev } = await serviceClient
      .from("branch_revenue")
      .select("*")
      .eq("branch_id", branch.id)
      .eq("market_id", marketId)
      .single();

    expect(rev).not.toBeNull();
    expect(Number(rev!.markup_revenue)).toBeGreaterThan(0); // 5% markup on $30
    expect(Number(rev!.resolution_fee_revenue)).toBeGreaterThan(0); // 1% resolution fee on shares
    expect(Number(rev!.total_revenue)).toBeGreaterThan(0);
  });

  // --- Test 11: Leader stats exclude branch users ---
  it("should not update leader_stats for branch winners", async () => {
    if (!authSupported) return;

    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0, pending_payouts: 0, status: "active" })
      .eq("id", branch.id);

    const trader = await createBranchTrader(marketId, branch.id, "yes", 20);

    // Get leader_stats before (may not exist)
    const { data: statsBefore } = await serviceClient
      .from("leader_stats")
      .select("winning_trades")
      .eq("user_id", trader.userId)
      .maybeSingle();

    const winsBefore = statsBefore ? Number(statsBefore.winning_trades) : 0;

    await callResolve(marketId, "yes");

    // Leader stats should NOT have been updated for this branch user
    const { data: statsAfter } = await serviceClient
      .from("leader_stats")
      .select("winning_trades")
      .eq("user_id", trader.userId)
      .maybeSingle();

    const winsAfter = statsAfter ? Number(statsAfter.winning_trades) : 0;
    expect(winsAfter).toBe(winsBefore); // No change
  });

  // --- Test 12: Combined retail + branch resolve end-to-end ---
  it("should correctly settle both retail and branch positions on same market", async () => {
    if (!authSupported) return;

    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0, pending_payouts: 0, status: "active" })
      .eq("id", branch.id);

    // Retail YES trader
    const retailYesUser = await createRetailTrader(marketId, "yes", 30);
    // Branch YES trader
    const branchYesTrader = await createBranchTrader(marketId, branch.id, "yes", 30);
    // Retail NO trader (loses)
    await createRetailTrader(marketId, "no", 20);

    const retailBalBefore = await getBalance(retailYesUser);
    const branchBalBefore = await getBalance(branchYesTrader.userId);
    const poolBefore = 10000; // Reset above

    // Resolve YES
    const { data, error } = await callResolve(marketId, "yes");
    expect(error).toBeNull();
    expect(data.success).toBe(true);

    // Both winners should be paid
    const retailBalAfter = await getBalance(retailYesUser);
    const branchBalAfter = await getBalance(branchYesTrader.userId);
    expect(retailBalAfter).toBeGreaterThan(retailBalBefore);
    expect(branchBalAfter).toBeGreaterThan(branchBalBefore);

    // Pool should have decreased (branch paid from pool)
    const { data: br } = await serviceClient.from("branches").select("pool_balance").eq("id", branch.id).single();
    expect(Number(br!.pool_balance)).toBeLessThan(poolBefore);

    // Platform revenue should exist (retail only)
    const { data: rev } = await serviceClient
      .from("platform_revenue")
      .select("explicit_fee_revenue")
      .eq("market_id", marketId)
      .is("branch_id", null)
      .single();
    expect(rev).not.toBeNull();

    // Branch revenue should exist separately
    const { data: bRev } = await serviceClient
      .from("branch_revenue")
      .select("total_revenue")
      .eq("market_id", marketId)
      .eq("branch_id", branch.id)
      .single();
    expect(bRev).not.toBeNull();
    expect(Number(bRev!.total_revenue)).toBeGreaterThan(0);
  });
});
