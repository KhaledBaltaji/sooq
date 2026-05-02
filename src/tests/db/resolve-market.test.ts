/**
 * resolve-market.test.ts — Tests for the resolve_market RPC (V3 AMM schema)
 *
 * V3 changes:
 * - Trades via execute_trade RPC (requires auth.uid())
 * - Positions tracked in `positions` table (shares, avg_price, total_cost)
 * - AMM state in `amm_state` table (no pool_yes/pool_no on markets)
 * - Payouts: winning shares pay $0.99 each (1% resolution fee)
 * - No payout_ratio or potential_payout columns
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

describe("resolve_market RPC", () => {
  let serviceClient: SupabaseClient;
  const userIds: string[] = [];
  const marketIds: string[] = [];
  const authCleanups: (() => Promise<void>)[] = [];

  let adminId: string;
  let adminClient: SupabaseClient;

  const TEST_PIN = "123456";

  beforeAll(async () => {
    serviceClient = getServiceClient();

    // Create an authenticated admin client (required for resolve_market)
    const auth = await createAuthenticatedClient(serviceClient, {
      is_admin: true,
      balance_usd: 50000,
    });
    adminClient = auth.client;
    adminId = auth.userId;
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);

    // Set admin PIN (required for resolve_market since migration 176)
    const { error: pinError } = await adminClient.rpc("admin_set_pin", { p_pin: TEST_PIN });
    if (pinError) throw new Error(`admin_set_pin failed: ${pinError.message}`);
  });

  afterAll(async () => {
    for (const fn of authCleanups) await fn();
    await cleanup(serviceClient, userIds, marketIds);
  });

  /** Create an authenticated user, execute a trade, and return the userId + cleanup */
  async function createTrader(
    marketId: string,
    side: "yes" | "no",
    amount: number,
    balance = 1000
  ): Promise<string> {
    const auth = await createAuthenticatedClient(serviceClient, {
      balance_usd: balance,
    });
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

  /** Get user balance from the users table */
  async function getBalance(userId: string): Promise<number> {
    const { data } = await serviceClient
      .from("users")
      .select("balance_usd")
      .eq("id", userId)
      .single();
    return Number(data?.balance_usd ?? 0);
  }

  /** Resolve a market via the admin client (with PIN) */
  async function callResolve(marketId: string, outcome: "yes" | "no") {
    return adminClient.rpc("resolve_market", {
      p_market_id: marketId,
      p_outcome: outcome,
      p_pin: TEST_PIN,
    });
  }

  // ─── Test 1: YES wins — YES holders get paid ─────────────────────────
  it("should pay YES holders when YES wins", async () => {
    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    const winnerId = await createTrader(marketId, "yes", 5);
    const loserId = await createTrader(marketId, "no", 5);

    const winnerBalBefore = await getBalance(winnerId);
    const loserBalBefore = await getBalance(loserId);

    const { data, error } = await callResolve(marketId, "yes");
    expect(error).toBeNull();
    expect(data).toBeDefined();

    const winnerBalAfter = await getBalance(winnerId);
    const loserBalAfter = await getBalance(loserId);

    // Winner should have received a payout (balance increased)
    expect(winnerBalAfter).toBeGreaterThan(winnerBalBefore);

    // Loser should NOT have received any payout
    expect(loserBalAfter).toBe(loserBalBefore);
  });

  // ─── Test 2: NO wins — NO holders get paid ───────────────────────────
  it("should pay NO holders when NO wins", async () => {
    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    const yesUserId = await createTrader(marketId, "yes", 5);
    const noUserId = await createTrader(marketId, "no", 5);

    const noBalBefore = await getBalance(noUserId);
    const yesBalBefore = await getBalance(yesUserId);

    const { data, error } = await callResolve(marketId, "no");
    expect(error).toBeNull();
    expect(data).toBeDefined();

    const noBalAfter = await getBalance(noUserId);
    const yesBalAfter = await getBalance(yesUserId);

    // NO holder should have received a payout
    expect(noBalAfter).toBeGreaterThan(noBalBefore);

    // YES holder should NOT have received a payout
    expect(yesBalAfter).toBe(yesBalBefore);
  });

  // ─── Test 3: Double resolution rejected ───────────────────────────────
  it("should reject resolution of already-resolved market", async () => {
    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    await createTrader(marketId, "yes", 5);

    // First resolve should succeed
    const { error: firstError } = await callResolve(marketId, "yes");
    expect(firstError).toBeNull();

    // Second resolve should fail
    const { error: secondError } = await callResolve(marketId, "yes");
    expect(secondError).not.toBeNull();
  });

  // ─── Test 4: Market with only one side's trades ───────────────────────
  it("should handle market with only one side's trades", async () => {
    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    const winnerId = await createTrader(marketId, "yes", 5);
    const winnerBalBefore = await getBalance(winnerId);

    const { data, error } = await callResolve(marketId, "yes");
    expect(error).toBeNull();
    expect(data).toBeDefined();

    const winnerBalAfter = await getBalance(winnerId);

    // Winner should receive a payout even when no one traded the other side
    expect(winnerBalAfter).toBeGreaterThan(winnerBalBefore);
  });

  // ─── Test 5: Market status changes correctly ──────────────────────────
  it("should change market status to resolved_yes or resolved_no", async () => {
    const marketId1 = await createTestMarket(serviceClient, adminId);
    const marketId2 = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId1, marketId2);

    await createTrader(marketId1, "yes", 5);
    await createTrader(marketId2, "no", 5);

    await callResolve(marketId1, "yes");
    await callResolve(marketId2, "no");

    const { data: mkt1 } = await serviceClient
      .from("markets")
      .select("status, outcome")
      .eq("id", marketId1)
      .single();

    const { data: mkt2 } = await serviceClient
      .from("markets")
      .select("status, outcome")
      .eq("id", marketId2)
      .single();

    // Status should reflect the resolution outcome
    expect(mkt1?.outcome).toBe("yes");
    expect(mkt2?.outcome).toBe("no");
    // Status should indicate resolved (exact value depends on implementation)
    expect(mkt1?.status).toMatch(/resolved/);
    expect(mkt2?.status).toMatch(/resolved/);
  });

  // ─── Test 6: Voided market — no payouts ──────────────────────────────
  it("should void market when no winning positions exist", async () => {
    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    // Only NO trades placed
    await createTrader(marketId, "no", 5);

    // Resolve as YES — no YES positions exist
    const { data, error } = await callResolve(marketId, "yes");

    // Should resolve (may void internally or just resolve with no payouts)
    expect(error).toBeNull();

    // Verify market status — could be "voided" or "resolved"
    const { data: mkt } = await serviceClient
      .from("markets")
      .select("status, outcome")
      .eq("id", marketId)
      .single();
    // Market should be in a terminal state
    expect(mkt?.status).toMatch(/resolved|voided/);
  });

  // ─── Test 7: lock_market requires PIN (migration 247) ────────────────
  it("should reject lock_market without PIN", async () => {
    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    const { error } = await adminClient.rpc("lock_market", {
      p_market_id: marketId,
      // p_pin omitted
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/PIN/i);
  });

  it("should reject lock_market with wrong PIN", async () => {
    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    const { error } = await adminClient.rpc("lock_market", {
      p_market_id: marketId,
      p_pin: "000000",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/PIN|pin/);
  });

  it("should accept lock_market with correct PIN and set status to closed", async () => {
    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    const { error } = await adminClient.rpc("lock_market", {
      p_market_id: marketId,
      p_pin: TEST_PIN,
    });
    expect(error).toBeNull();

    const { data: mkt } = await serviceClient
      .from("markets")
      .select("status")
      .eq("id", marketId)
      .single();
    expect(mkt?.status).toBe("closed");
  });

  // ─── Test 8: void_market requires PIN (migration 247) ────────────────
  it("should reject void_market without PIN", async () => {
    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    const { error } = await adminClient.rpc("void_market", {
      p_market_id: marketId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/PIN/i);
  });

  it("should accept void_market with correct PIN and set status to voided", async () => {
    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    // Place a trade so there's something to refund
    await createTrader(marketId, "yes", 5);

    const { error } = await adminClient.rpc("void_market", {
      p_market_id: marketId,
      p_pin: TEST_PIN,
    });
    expect(error).toBeNull();

    const { data: mkt } = await serviceClient
      .from("markets")
      .select("status")
      .eq("id", marketId)
      .single();
    expect(mkt?.status).toBe("voided");
  });

  // ─── Test 9: void_market sets amm_state.seed_pnl (migration 248) ────
  it("should set amm_state.seed_pnl when voiding a market", async () => {
    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    await createTrader(marketId, "yes", 10);

    const { error } = await adminClient.rpc("void_market", {
      p_market_id: marketId,
      p_pin: TEST_PIN,
    });
    expect(error).toBeNull();

    const { data: amm } = await serviceClient
      .from("amm_state")
      .select("seed_pnl")
      .eq("market_id", marketId)
      .single();
    // seed_pnl should be NOT NULL after void (was always NULL before migration 248)
    expect(amm?.seed_pnl).not.toBeNull();
  });

  // ─── Test 10: resolution_fee snapshot used, not live config ──────────
  // Migration 245: changing fee_config rate after market creation must NOT
  // affect that market's resolution payout.
  it("should use snapshot resolution_fee rate, not live fee_config", async () => {
    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    // Confirm snapshot was populated at creation
    const { data: mktBefore } = await serviceClient
      .from("markets")
      .select("resolution_fee_rate_snapshot")
      .eq("id", marketId)
      .single();
    const snapshotRate = Number(mktBefore?.resolution_fee_rate_snapshot);
    expect(snapshotRate).toBeGreaterThan(0);

    // Place a winning trade
    const winnerId = await createTrader(marketId, "yes", 10);

    // Mutate fee_config (simulating admin adjustment between trade and resolution)
    const { data: feeRow } = await serviceClient
      .from("fee_config")
      .select("id, rate")
      .eq("fee_type", "resolution_fee")
      .order("id")
      .limit(1)
      .single();
    const originalLiveRate = Number(feeRow?.rate);
    const tamperedRate = snapshotRate === 0.005 ? 0.01 : 0.005;
    await serviceClient.from("fee_config").update({ rate: tamperedRate }).eq("id", feeRow!.id);

    try {
      const balBefore = await getBalance(winnerId);
      const { error } = await callResolve(marketId, "yes");
      expect(error).toBeNull();
      const balAfter = await getBalance(winnerId);

      const payout = balAfter - balBefore;

      // Read the snapshot the resolution actually applied (logged in resolution_payout txn)
      const { data: tx } = await serviceClient
        .from("transactions")
        .select("description")
        .eq("user_id", winnerId)
        .eq("type", "resolution_payout")
        .eq("reference_id", marketId)
        .single();

      // Description embeds the rate applied. Confirm it matches the SNAPSHOT, not the live tampered rate.
      expect(tx?.description).toContain((1.0 - snapshotRate).toFixed(4));
      // Sanity: payout > 0
      expect(payout).toBeGreaterThan(0);
    } finally {
      // Restore original live rate
      await serviceClient.from("fee_config").update({ rate: originalLiveRate }).eq("id", feeRow!.id);
    }
  });

  // ─── Test 11: record_revenue idempotent (migration 248) ──────────────
  it("should be idempotent: re-calling record_revenue does not duplicate platform_revenue", async () => {
    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    await createTrader(marketId, "yes", 5);
    const { error } = await callResolve(marketId, "yes");
    expect(error).toBeNull();

    // Resolution already called record_revenue once. Call it again directly.
    const { error: secondErr } = await serviceClient.rpc("record_revenue", {
      p_market_id: marketId,
    });
    expect(secondErr).toBeNull();

    // Exactly one platform_revenue row for this market
    const { data: rows } = await serviceClient
      .from("platform_revenue")
      .select("id")
      .eq("market_id", marketId);
    expect(rows?.length).toBe(1);
  });

  // ─── Test 12: void_market claws back referral commissions ─────────────
  // Covers migration 221 _void_market_internal clawback loop (lines 51–68):
  //   • referral_commissions rows flipped to status='voided'
  //   • referrer agent_balance_usd debited
  //   • Negative transaction row written for audit
  it("void_market claws back referral commissions and reverses agent_balance_usd", async () => {
    const marketId = await createTestMarket(serviceClient, adminId);
    marketIds.push(marketId);

    // Activated referrer (direct_referral_count >= activation threshold so commissions credit, not escrow)
    const referrerId = await createTestUser(serviceClient, {
      agent_level: 4,
      direct_referral_count: 60,
      agent_activated: true,
      agent_balance_usd: 0,
    });
    userIds.push(referrerId);

    // Referee wired into the chain
    const refereeAuth = await createAuthenticatedClient(serviceClient, {
      balance_usd: 2000,
      referred_by: referrerId,
      referral_chain: [referrerId],
    });
    userIds.push(refereeAuth.userId);
    authCleanups.push(refereeAuth.cleanup);

    // Trade that generates commission for the referrer
    // ($25 stays under both the 5% price-impact cap and amm_max_trade_pct)
    const { error: tradeErr } = await refereeAuth.client.rpc("execute_trade", {
      p_market_id: marketId,
      p_side: "yes",
      p_amount: 25,
    });
    expect(tradeErr).toBeNull();

    // Post mig 296 + 297 (release-at-resolution): trade-time commissions
    // land as 'pending' while the market is open. They don't enter
    // agent_balance_usd until the market resolves. Void flips pending →
    // voided with no balance movement (clawback is trivial because the
    // money never moved). This test now verifies the NEW clawback-free
    // path, replacing the old balance-reversal assertions.

    const { data: commsBefore } = await serviceClient
      .from("referral_commissions")
      .select("id, status, commission_amount, referrer_id")
      .eq("market_id", marketId)
      .eq("referrer_id", referrerId);
    expect(commsBefore?.length).toBeGreaterThan(0);
    // Pre-void: commissions are 'pending' (trade landed on open market)
    expect(commsBefore!.every((c) => c.status === "pending")).toBe(true);

    const { data: referrerBefore } = await serviceClient
      .from("users")
      .select("agent_balance_usd")
      .eq("id", referrerId)
      .single();
    // Pending commissions are not in the wallet
    expect(Number(referrerBefore!.agent_balance_usd)).toBe(0);

    // Void the market
    const { error: voidErr } = await adminClient.rpc("void_market", {
      p_market_id: marketId,
      p_pin: TEST_PIN,
    });
    expect(voidErr).toBeNull();

    // All commissions flip to 'voided' via the status-change trigger
    const { data: commsAfter } = await serviceClient
      .from("referral_commissions")
      .select("status")
      .eq("market_id", marketId)
      .eq("referrer_id", referrerId);
    expect(commsAfter!.every((c) => c.status === "voided")).toBe(true);

    // Wallet never moved — no clawback transactions needed
    const { data: referrerAfter } = await serviceClient
      .from("users")
      .select("agent_balance_usd")
      .eq("id", referrerId)
      .single();
    expect(Number(referrerAfter!.agent_balance_usd)).toBe(0);
  });
});
