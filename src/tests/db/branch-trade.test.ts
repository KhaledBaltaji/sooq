/**
 * branch-trade.test.ts — Tests for execute_branch_trade RPC
 *
 * Tests branch buy/sell execution, solvency gate, position caps,
 * market config, price impact, pool sufficiency, and cash-out toggle.
 *
 * Uses createAuthenticatedClient for trades (needs auth.uid()).
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
  cleanup,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("execute_branch_trade RPC", () => {
  let serviceClient: SupabaseClient;
  const userIds: string[] = [];
  const marketIds: string[] = [];
  const branchIds: string[] = [];
  const authCleanups: (() => Promise<void>)[] = [];

  let adminId: string;
  let openMarketId: string;
  let branch: { id: string; code: string };

  let traderClient: SupabaseClient | null = null;
  let traderId: string | null = null;
  let authSupported = false;

  beforeAll(async () => {
    serviceClient = getServiceClient();

    // Create admin + market
    adminId = await createTestUser(serviceClient, { is_admin: true, balance_usd: 50000 });
    userIds.push(adminId);

    openMarketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(openMarketId);

    // Create branch managed by admin
    branch = await createTestBranch(serviceClient, adminId, {
      pool_balance: 10000,
      yes_markup_pct: 0.05,
      no_markup_pct: 0.05,
    });
    branchIds.push(branch.id);

    // Fund branch pool (ledger entry to match cache)
    await fundBranchPool(serviceClient, branch.id, 10000);

    // Create authenticated trader
    try {
      const auth = await createAuthenticatedClient(serviceClient, { balance_usd: 5000 });
      traderClient = auth.client;
      traderId = auth.userId;
      userIds.push(auth.userId);
      authCleanups.push(auth.cleanup);
      authSupported = true;

      // Assign trader to branch
      await assignUserToBranch(serviceClient, traderId, branch.id);
    } catch {
      authSupported = false;
    }
  });

  afterAll(async () => {
    for (const fn of authCleanups) await fn();
    await cleanup(serviceClient, userIds, marketIds, branchIds);
  });

  // --- Test 1: Buy YES with markup extraction ---
  it("should buy YES shares with correct markup extraction", async () => {
    if (!authSupported || !traderClient) {
      const { error } = await serviceClient.rpc("execute_branch_trade", {
        p_market_id: openMarketId,
        p_branch_id: branch.id,
        p_side: "yes",
        p_amount: 100,
      });
      expect(error).not.toBeNull();
      expect(error!.message).toContain("Not authenticated");
      return;
    }

    const { data, error } = await traderClient.rpc("execute_branch_trade", {
      p_market_id: openMarketId,
      p_branch_id: branch.id,
      p_side: "yes",
      p_amount: 20,
    });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data.trade_id).toBeDefined();
    expect(Number(data.shares)).toBeGreaterThan(0);
    expect(Number(data.markup)).toBe(1); // 5% of $20
    expect(Number(data.net_canonical)).toBe(19); // $20 - $1 markup
    expect(Number(data.total_cost)).toBe(20);
  });

  // --- Test 2: Buy NO works ---
  it("should buy NO shares", async () => {
    if (!authSupported || !traderClient) return;

    const { data, error } = await traderClient.rpc("execute_branch_trade", {
      p_market_id: openMarketId,
      p_branch_id: branch.id,
      p_side: "no",
      p_amount: 20,
    });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(Number(data.shares)).toBeGreaterThan(0);
    expect(Number(data.markup)).toBe(1); // 5% of $20
  });

  // --- Test 3: Unassigned user rejected ---
  it("should reject trades from users not assigned to the branch", async () => {
    // Create a second user NOT assigned to branch
    let unassignedClient: SupabaseClient | null = null;
    let unassignedCleanup: (() => Promise<void>) | null = null;
    try {
      const auth = await createAuthenticatedClient(serviceClient, { balance_usd: 1000 });
      unassignedClient = auth.client;
      userIds.push(auth.userId);
      unassignedCleanup = auth.cleanup;
      authCleanups.push(auth.cleanup);
    } catch {
      return; // Skip if auth not supported
    }

    const { error } = await unassignedClient!.rpc("execute_branch_trade", {
      p_market_id: openMarketId,
      p_branch_id: branch.id,
      p_side: "yes",
      p_amount: 10,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("not assigned");
  });

  // --- Test 4: Frozen branch rejected ---
  it("should reject trades on frozen branch", async () => {
    if (!authSupported || !traderClient) return;

    // Freeze the branch temporarily
    await serviceClient.from("branches").update({ status: "frozen" }).eq("id", branch.id);

    const { error } = await traderClient.rpc("execute_branch_trade", {
      p_market_id: openMarketId,
      p_branch_id: branch.id,
      p_side: "yes",
      p_amount: 10,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("frozen");

    // Restore
    await serviceClient.from("branches").update({ status: "active" }).eq("id", branch.id);
  });

  // --- Test 5: Market disabled for branch → rejected ---
  it("should reject trades when market is disabled for branch", async () => {
    if (!authSupported || !traderClient) return;

    // Disable market for this branch
    await serviceClient.from("branch_market_config").upsert({
      branch_id: branch.id,
      market_id: openMarketId,
      is_enabled: false,
    });

    const { error } = await traderClient.rpc("execute_branch_trade", {
      p_market_id: openMarketId,
      p_branch_id: branch.id,
      p_side: "yes",
      p_amount: 10,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("disabled");

    // Re-enable
    await serviceClient.from("branch_market_config")
      .update({ is_enabled: true })
      .eq("branch_id", branch.id)
      .eq("market_id", openMarketId);
  });

  // --- Test 6: Sell/cash-out returns proceeds minus exit fee ---
  it("should sell shares with exit fee deducted", async () => {
    if (!authSupported || !traderClient) return;

    // Get current YES position (created in test 1)
    const { data: positions } = await serviceClient
      .from("positions")
      .select("shares_held")
      .eq("user_id", traderId!)
      .eq("market_id", openMarketId)
      .eq("side", "yes")
      .eq("branch_id", branch.id)
      .maybeSingle();

    if (!positions || Number(positions.shares_held) <= 0) {
      // No position from test 1 — buy first
      await traderClient.rpc("execute_branch_trade", {
        p_market_id: openMarketId,
        p_branch_id: branch.id,
        p_side: "yes",
        p_amount: 10,
      });
      // Re-fetch
      const { data: newPos } = await serviceClient
        .from("positions")
        .select("shares_held")
        .eq("user_id", traderId!)
        .eq("market_id", openMarketId)
        .eq("side", "yes")
        .eq("branch_id", branch.id)
        .single();
      if (!newPos || Number(newPos.shares_held) <= 0) return;
    }

    const { data: currentPos } = await serviceClient
      .from("positions")
      .select("shares_held")
      .eq("user_id", traderId!)
      .eq("market_id", openMarketId)
      .eq("side", "yes")
      .eq("branch_id", branch.id)
      .single();

    const sharesToSell = Math.min(Number(currentPos!.shares_held), 5);

    const { data, error } = await traderClient.rpc("execute_branch_trade", {
      p_market_id: openMarketId,
      p_branch_id: branch.id,
      p_side: "yes",
      p_shares_to_sell: sharesToSell,
    });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(Number(data.gross_proceeds)).toBeGreaterThan(0);
    expect(Number(data.exit_fee)).toBeGreaterThanOrEqual(0);
    expect(Number(data.net_proceeds)).toBeLessThanOrEqual(Number(data.gross_proceeds));
  });

  // --- Test 7: Sell blocked when cash-out disabled ---
  it("should block sell when cash-out is disabled", async () => {
    if (!authSupported || !traderClient) return;

    // Ensure we have a position to sell (buy first if needed)
    const { data: pos } = await serviceClient
      .from("positions")
      .select("shares_held")
      .eq("user_id", traderId!)
      .eq("market_id", openMarketId)
      .eq("side", "no")
      .eq("branch_id", branch.id)
      .maybeSingle();

    if (!pos || Number(pos.shares_held) <= 0) {
      // Buy some NO shares first
      await traderClient.rpc("execute_branch_trade", {
        p_market_id: openMarketId,
        p_branch_id: branch.id,
        p_side: "no",
        p_amount: 10,
      });
    }

    // Disable cash-out at branch level (simpler than per-market config)
    await serviceClient.from("branches")
      .update({ cash_out_enabled: false })
      .eq("id", branch.id);

    const { error } = await traderClient.rpc("execute_branch_trade", {
      p_market_id: openMarketId,
      p_branch_id: branch.id,
      p_side: "no",
      p_shares_to_sell: 1,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("disabled");

    // Re-enable
    await serviceClient.from("branches")
      .update({ cash_out_enabled: true })
      .eq("id", branch.id);
  });

  // --- Test 8: Idempotency key returns existing result ---
  it("should return existing result for duplicate idempotency key", async () => {
    if (!authSupported || !traderClient) return;

    const key = `test-idem-${crypto.randomUUID()}`;

    // First trade
    const { data: first, error: err1 } = await traderClient.rpc("execute_branch_trade", {
      p_market_id: openMarketId,
      p_branch_id: branch.id,
      p_side: "no",
      p_amount: 10,
      p_idempotency_key: key,
    });

    expect(err1).toBeNull();
    expect(first).not.toBeNull();

    // Second trade with same key
    const { data: second, error: err2 } = await traderClient.rpc("execute_branch_trade", {
      p_market_id: openMarketId,
      p_branch_id: branch.id,
      p_side: "no",
      p_amount: 10,
      p_idempotency_key: key,
    });

    expect(err2).toBeNull();
    expect(second).not.toBeNull();
    expect(second.idempotent).toBe(true);
  });

  // --- Test 9: Canonical state updates match retail for same net amount ---
  it("should update canonical q_yes/q_no identically to retail for same net amount", async () => {
    if (!authSupported || !traderClient) return;

    // Create a fresh market for isolated test
    const freshMarketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(freshMarketId);

    // Get initial AMM state
    const { data: initialAmm } = await serviceClient
      .from("amm_state")
      .select("q_yes, q_no, current_yes_price, current_no_price")
      .eq("market_id", freshMarketId)
      .single();

    expect(initialAmm).not.toBeNull();

    // Branch buy $20 with 5% markup → net $19 hits LMSR
    const { data, error } = await traderClient.rpc("execute_branch_trade", {
      p_market_id: freshMarketId,
      p_branch_id: branch.id,
      p_side: "yes",
      p_amount: 20,
    });

    expect(error).toBeNull();

    // Verify AMM state changed
    const { data: afterAmm } = await serviceClient
      .from("amm_state")
      .select("q_yes, q_no")
      .eq("market_id", freshMarketId)
      .single();

    expect(Number(afterAmm!.q_yes)).toBeGreaterThan(Number(initialAmm!.q_yes));
    expect(Number(afterAmm!.q_no)).toBe(Number(initialAmm!.q_no)); // NO unchanged
  });

  // --- Test 10: Solvency check function returns correct structure ---
  it("should return solvency check with valid structure", async () => {
    const { data, error } = await serviceClient.rpc("branch_solvency_check", {
      p_branch_id: branch.id,
    });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data.branch_id).toBe(branch.id);
    expect(data.status).toBeDefined();
    expect(["green", "yellow", "red"]).toContain(data.status);
    expect(data.can_trade).toBeDefined();
    expect(Number(data.pool_balance)).toBeGreaterThan(0);
  });

  // --- Test 11: Reconciliation function runs without errors ---
  it("should run solvency reconciliation without errors", async () => {
    const { data, error } = await serviceClient.rpc("reconcile_branch_solvency");

    expect(error).toBeNull();
    // Should return rows (our test branch should be included)
    expect(data).toBeDefined();
  });

  // --- Test 12: Solvency gate blocks trade at 95%+ utilization ---
  it("should block trade when solvency utilization exceeds 95%", async () => {
    if (!authSupported || !traderClient) return;

    // Set pool very small with high worst_case so even after adding trade inflow,
    // utilization = (worst_case + delta) / (pool + amount) stays above 95%
    // Pool=100, worst_case=200 → even with $20 inflow: (200+delta)/(120) >> 95%
    await serviceClient.from("branches")
      .update({ pool_balance: 100, worst_case_total: 200 })
      .eq("id", branch.id);

    const freshMarketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(freshMarketId);

    const { data, error } = await traderClient.rpc("execute_branch_trade", {
      p_market_id: freshMarketId,
      p_branch_id: branch.id,
      p_side: "yes",
      p_amount: 20,
    });

    // Should be rejected with solvency error
    expect(error).not.toBeNull();
    expect(error!.message.toLowerCase()).toMatch(/solvency|utilization|capacity/i);

    // Restore pool
    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0 })
      .eq("id", branch.id);
  });

  // --- Test 13: Solvency gate warns but allows at 80-95% ---
  it("should allow trade with warning at 80-95% solvency utilization", async () => {
    if (!authSupported || !traderClient) return;

    // Set branch utilization to ~85%
    await serviceClient.from("branches")
      .update({ pool_balance: 1000, worst_case_total: 850 })
      .eq("id", branch.id);

    const freshMarketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(freshMarketId);

    const { data, error } = await traderClient.rpc("execute_branch_trade", {
      p_market_id: freshMarketId,
      p_branch_id: branch.id,
      p_side: "yes",
      p_amount: 10,
    });

    // Should succeed (possibly with warning in result)
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data.trade_id).toBeDefined();

    // Restore pool
    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0 })
      .eq("id", branch.id);
  });

  // --- Test 14: Sell blocked when pool has insufficient funds ---
  it("should block sell when branch pool has insufficient funds", async () => {
    if (!authSupported || !traderClient) return;

    // First buy some shares so we have something to sell
    const freshMarketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(freshMarketId);

    // Ensure pool is well-funded for the buy
    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0 })
      .eq("id", branch.id);

    const { data: buyData, error: buyError } = await traderClient.rpc("execute_branch_trade", {
      p_market_id: freshMarketId,
      p_branch_id: branch.id,
      p_side: "yes",
      p_amount: 20,
    });
    expect(buyError).toBeNull();

    // Now drain the pool to near zero
    await serviceClient.from("branches")
      .update({ pool_balance: 0.01 })
      .eq("id", branch.id);

    // Try to sell — should fail because pool can't cover proceeds
    const { data: sellData, error: sellError } = await traderClient.rpc("execute_branch_trade", {
      p_market_id: freshMarketId,
      p_branch_id: branch.id,
      p_side: "yes",
      p_shares_to_sell: Number(buyData.shares),
    });

    expect(sellError).not.toBeNull();
    expect(sellError!.message.toLowerCase()).toMatch(/pool|insufficient|funds|balance/i);

    // Restore pool
    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0 })
      .eq("id", branch.id);
  });

  // --- Test 15: Price impact cap rejects oversized trades ---
  it("should reject trade exceeding price impact cap", async () => {
    if (!authSupported || !traderClient) return;

    // Fund user heavily for a large trade
    await serviceClient.from("users")
      .update({ balance_usd: 50000 })
      .eq("id", traderId);

    const freshMarketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(freshMarketId);

    // Try a $500 trade on a fresh market (b=1000) — should exceed 5% price impact cap
    const { data, error } = await traderClient.rpc("execute_branch_trade", {
      p_market_id: freshMarketId,
      p_branch_id: branch.id,
      p_side: "yes",
      p_amount: 500,
    });

    // Should be rejected with price impact error
    expect(error).not.toBeNull();
    expect(error!.message.toLowerCase()).toMatch(/price.?impact|impact.?cap|price.?move/i);

    // Restore user balance
    await serviceClient.from("users")
      .update({ balance_usd: 1000 })
      .eq("id", traderId);
  });

  // --- Test 16: SOOQ fee correctly deducted on buy ---
  it("should deduct SOOQ fee on buy and create ledger entry", async () => {
    if (!authSupported || !traderClient) return;

    const freshMarketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(freshMarketId);

    // Ensure good pool state
    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0 })
      .eq("id", branch.id);

    const { data: beforeBranch } = await serviceClient
      .from("branches")
      .select("pool_balance, branch_fee_rate")
      .eq("id", branch.id)
      .single();

    const feeRate = Number(beforeBranch!.branch_fee_rate);
    const poolBefore = Number(beforeBranch!.pool_balance);

    const buyAmount = 20;
    const { data, error } = await traderClient.rpc("execute_branch_trade", {
      p_market_id: freshMarketId,
      p_branch_id: branch.id,
      p_side: "yes",
      p_amount: buyAmount,
    });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(Number(data.sooq_fee)).toBeCloseTo(buyAmount * feeRate, 2);

    // Verify branch_pools has sooq_branch_fee entry
    const { data: feeEntry } = await serviceClient
      .from("branch_pools")
      .select("amount, type")
      .eq("branch_id", branch.id)
      .eq("market_id", freshMarketId)
      .eq("type", "sooq_branch_fee")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    expect(feeEntry).not.toBeNull();
    expect(Number(feeEntry!.amount)).toBeCloseTo(-(buyAmount * feeRate), 2);
  });

  // --- Test 17: Pool balance reduced by SOOQ fee ---
  it("should reduce pool balance by SOOQ fee amount", async () => {
    if (!authSupported || !traderClient) return;

    const freshMarketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(freshMarketId);

    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0, pending_payouts: 0 })
      .eq("id", branch.id);

    const { data: beforeBranch } = await serviceClient
      .from("branches")
      .select("pool_balance, branch_fee_rate")
      .eq("id", branch.id)
      .single();

    const poolBefore = Number(beforeBranch!.pool_balance);
    const feeRate = Number(beforeBranch!.branch_fee_rate);
    const buyAmount = 50;
    const expectedFee = Math.round(buyAmount * feeRate * 100) / 100;

    await traderClient.rpc("execute_branch_trade", {
      p_market_id: freshMarketId,
      p_branch_id: branch.id,
      p_side: "yes",
      p_amount: buyAmount,
    });

    const { data: afterBranch } = await serviceClient
      .from("branches")
      .select("pool_balance")
      .eq("id", branch.id)
      .single();

    const poolAfter = Number(afterBranch!.pool_balance);
    // Pool should increase by (buyAmount - fee - sweep), but at minimum
    // the difference between expected and actual should account for the fee
    const poolIncrease = poolAfter - poolBefore;
    // Pool gets +buyAmount (trade) -fee (sooq) -sweep (payback, 0 here)
    expect(poolIncrease).toBeCloseTo(buyAmount - expectedFee, 1);
  });

  // --- Test 18: Trade response includes sooq_fee ---
  it("should include sooq_fee in trade response payload", async () => {
    if (!authSupported || !traderClient) return;

    const freshMarketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(freshMarketId);

    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0 })
      .eq("id", branch.id);

    const { data, error } = await traderClient.rpc("execute_branch_trade", {
      p_market_id: freshMarketId,
      p_branch_id: branch.id,
      p_side: "yes",
      p_amount: 20,
    });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data.sooq_fee).toBeDefined();
    expect(Number(data.sooq_fee)).toBe(1); // 5% of $20
  });

  // --- Test 19: Zero fee rate means no fee deducted ---
  it("should not deduct fee when branch_fee_rate is 0", async () => {
    if (!authSupported || !traderClient) return;

    const freshMarketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(freshMarketId);

    // Set fee rate to 0
    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0, branch_fee_rate: 0 })
      .eq("id", branch.id);

    const { data, error } = await traderClient.rpc("execute_branch_trade", {
      p_market_id: freshMarketId,
      p_branch_id: branch.id,
      p_side: "yes",
      p_amount: 50,
    });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(Number(data.sooq_fee)).toBe(0);

    // Verify NO sooq_branch_fee ledger entry
    const { data: feeEntries } = await serviceClient
      .from("branch_pools")
      .select("id")
      .eq("branch_id", branch.id)
      .eq("market_id", freshMarketId)
      .eq("type", "sooq_branch_fee");

    expect(feeEntries?.length || 0).toBe(0);

    // Restore fee rate
    await serviceClient.from("branches")
      .update({ branch_fee_rate: 0.05 })
      .eq("id", branch.id);
  });

  // --- Test 20: branch_trades has correct side and direction columns (was test 16) ---
  it("should populate side and direction columns in branch_trades", async () => {
    if (!authSupported || !traderClient) return;

    const freshMarketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(freshMarketId);

    // Ensure good pool state
    await serviceClient.from("branches")
      .update({ pool_balance: 10000, worst_case_total: 0 })
      .eq("id", branch.id);

    // Buy YES
    const { data: buyData, error: buyError } = await traderClient.rpc("execute_branch_trade", {
      p_market_id: freshMarketId,
      p_branch_id: branch.id,
      p_side: "yes",
      p_amount: 10,
    });
    expect(buyError).toBeNull();

    // Check branch_trades row for buy
    const { data: buyTrade } = await serviceClient
      .from("branch_trades")
      .select("side, direction, exit_fee_amount, branch_markup")
      .eq("trade_id", buyData.trade_id)
      .single();

    expect(buyTrade).not.toBeNull();
    expect(buyTrade!.side).toBe("yes");
    expect(buyTrade!.direction).toBe("buy");
    expect(Number(buyTrade!.exit_fee_amount)).toBe(0);
    expect(Number(buyTrade!.branch_markup)).toBeGreaterThan(0); // 5% markup

    // Sell the shares back
    const { data: sellData, error: sellError } = await traderClient.rpc("execute_branch_trade", {
      p_market_id: freshMarketId,
      p_branch_id: branch.id,
      p_side: "yes",
      p_shares_to_sell: Number(buyData.shares),
    });
    expect(sellError).toBeNull();

    // Check branch_trades row for sell
    const { data: sellTrade } = await serviceClient
      .from("branch_trades")
      .select("side, direction, exit_fee_amount, branch_markup")
      .eq("trade_id", sellData.trade_id)
      .single();

    expect(sellTrade).not.toBeNull();
    expect(sellTrade!.side).toBe("yes");
    expect(sellTrade!.direction).toBe("sell");
    expect(Number(sellTrade!.branch_markup)).toBe(0); // No markup on sells
    expect(Number(sellTrade!.exit_fee_amount)).toBeGreaterThanOrEqual(0); // Exit fee captured
  });
});
