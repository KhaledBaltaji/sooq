/**
 * Agent Wallet -- Database Integration Tests
 *
 * Tests the separate agent wallet system:
 *   - Commissions credit to agent_balance_usd (not balance_usd)
 *   - transfer_agent_to_portfolio RPC
 *   - Validation: insufficient balance, zero/negative amounts
 *   - Frozen account rejection
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  getServiceClient,
  createTestUser,
  createTestMarket,
  createAuthenticatedClient,
  createReferralChain,
  fundUser,
  fundAgentWallet,
  cleanup,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

let sb: SupabaseClient;
let createdUsers: string[] = [];
let createdMarkets: string[] = [];
let authCleanups: (() => Promise<void>)[] = [];

beforeAll(async () => {
  sb = getServiceClient();
});

afterEach(async () => {
  for (const fn of authCleanups) {
    await fn().catch(() => {});
  }
  authCleanups = [];
  await cleanup(sb, createdUsers, createdMarkets);
  createdUsers = [];
  createdMarkets = [];
});

// ---------------------------------------------------------------------------
// Helper: get user balances
// ---------------------------------------------------------------------------
async function getBalances(userId: string) {
  const { data } = await sb
    .from("users")
    .select("balance_usd, agent_balance_usd")
    .eq("id", userId)
    .single();
  return {
    portfolio: Number(data?.balance_usd ?? 0),
    agent: Number(data?.agent_balance_usd ?? 0),
  };
}

// ======================================================================
// TESTS
// ======================================================================

describe("Agent Wallet", () => {
  // ====================================================================
  // 1. Transfer full agent balance to portfolio
  // ====================================================================
  it("1. transfer full agent balance to portfolio", async () => {
    const { client, userId, cleanup: authCleanup } =
      await createAuthenticatedClient(sb, {
        balance_usd: 100,
        agent_balance_usd: 50,
      });
    createdUsers.push(userId);
    authCleanups.push(authCleanup);

    // Also seed agent wallet ledger for consistency
    await sb.from("transactions").insert({
      user_id: userId,
      type: "commission",
      amount: 50,
      balance_after: 50,
      description: "Test commission",
    });

    const { data, error } = await client.rpc("transfer_agent_to_portfolio", {
      p_amount: 50,
    });

    expect(error).toBeNull();
    const result = data as unknown as { agent_balance_usd: number; balance_usd: number };
    expect(result.agent_balance_usd).toBe(0);
    expect(result.balance_usd).toBe(150);

    // Verify persisted
    const balances = await getBalances(userId);
    expect(balances.agent).toBe(0);
    expect(balances.portfolio).toBe(150);

    // Verify ledger entries created
    const { data: txns } = await sb
      .from("transactions")
      .select("type, amount")
      .eq("user_id", userId)
      .in("type", ["agent_transfer_out", "agent_transfer_in"]);

    expect(txns).toHaveLength(2);
    const outTx = txns!.find((t: any) => t.type === "agent_transfer_out");
    const inTx = txns!.find((t: any) => t.type === "agent_transfer_in");
    expect(Number(outTx!.amount)).toBe(-50);
    expect(Number(inTx!.amount)).toBe(50);
  });

  // ====================================================================
  // 2. Partial transfer
  // ====================================================================
  it("2. partial transfer from agent wallet to portfolio", async () => {
    const { client, userId, cleanup: authCleanup } =
      await createAuthenticatedClient(sb, {
        balance_usd: 100,
        agent_balance_usd: 80,
      });
    createdUsers.push(userId);
    authCleanups.push(authCleanup);

    const { data, error } = await client.rpc("transfer_agent_to_portfolio", {
      p_amount: 30,
    });

    expect(error).toBeNull();
    const result = data as unknown as { agent_balance_usd: number; balance_usd: number };
    expect(result.agent_balance_usd).toBe(50);
    expect(result.balance_usd).toBe(130);
  });

  // ====================================================================
  // 3. Insufficient agent wallet balance
  //
  // REGRESSION NOTE (migration 250): the primary gate is now
  // "Insufficient unlocked balance" (available-based), not
  // "Insufficient agent wallet balance" (total-based). With no
  // referral_commissions rows, pending=0 and available=total, so
  // the functional behavior is identical — only the error message
  // changes. Legacy wording kept as a compatibility fallback path
  // in the RPC but should never be hit when the unlock gate runs first.
  // ====================================================================
  it("3. rejects transfer exceeding agent wallet balance", async () => {
    const { client, userId, cleanup: authCleanup } =
      await createAuthenticatedClient(sb, {
        balance_usd: 100,
        agent_balance_usd: 10,
      });
    createdUsers.push(userId);
    authCleanups.push(authCleanup);

    const { error } = await client.rpc("transfer_agent_to_portfolio", {
      p_amount: 20,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/Insufficient (unlocked|agent wallet) balance/);
  });

  // ====================================================================
  // 4. Zero and negative amounts rejected
  // ====================================================================
  it("4. rejects zero and negative transfer amounts", async () => {
    const { client, userId, cleanup: authCleanup } =
      await createAuthenticatedClient(sb, {
        balance_usd: 100,
        agent_balance_usd: 50,
      });
    createdUsers.push(userId);
    authCleanups.push(authCleanup);

    const { error: zeroErr } = await client.rpc("transfer_agent_to_portfolio", {
      p_amount: 0,
    });
    expect(zeroErr).not.toBeNull();
    expect(zeroErr!.message).toContain("Amount must be positive");

    const { error: negErr } = await client.rpc("transfer_agent_to_portfolio", {
      p_amount: -10,
    });
    expect(negErr).not.toBeNull();
    expect(negErr!.message).toContain("Amount must be positive");
  });

  // ====================================================================
  // 5. Commission credits agent wallet (not portfolio)
  // ====================================================================
  it("5. trade commission creates pending row, resolve credits agent_balance_usd (not portfolio)", async () => {
    // Post mig 296 + 297: trade-time commissions land as 'pending' on
    // open markets. agent_balance_usd only credits when the market
    // resolves (trigger on markets.status sweeps pending → credited).
    // This test asserts the two-step path.
    const { userA, userB, userC, userD } = await createReferralChain(sb);
    createdUsers.push(userA, userB, userC, userD);

    const marketId = await createTestMarket(sb, userA);
    createdMarkets.push(marketId);

    const cBefore = await getBalances(userC);
    const bBefore = await getBalances(userB);

    const { client: dClient, userId: dUserId, cleanup: dCleanup } =
      await createAuthenticatedClient(sb, {
        referred_by: userC,
        referral_chain: [userC, userB, userA],
        balance_usd: 500,
      });
    createdUsers.push(dUserId);
    authCleanups.push(dCleanup);

    await dClient.rpc("execute_trade", {
      p_market_id: marketId,
      p_side: "yes",
      p_amount: 10,
    });

    // Step 1: before resolve, commissions are pending; balances unchanged.
    const cMid = await getBalances(userC);
    const bMid = await getBalances(userB);
    expect(cMid.agent).toBe(cBefore.agent);
    expect(cMid.portfolio).toBe(cBefore.portfolio);
    expect(bMid.agent).toBe(bBefore.agent);
    expect(bMid.portfolio).toBe(bBefore.portfolio);

    const { data: pendingComms } = await sb
      .from("referral_commissions")
      .select("status, referrer_id")
      .eq("trader_id", dUserId);
    expect(pendingComms?.length).toBeGreaterThan(0);
    expect(pendingComms!.every((c) => c.status === "pending")).toBe(true);

    // Step 2: resolve the market → trigger releases pending to credited
    await sb
      .from("markets")
      .update({ status: "resolved", outcome: "yes", resolved_at: new Date().toISOString() })
      .eq("id", marketId);

    const cAfter = await getBalances(userC);
    const bAfter = await getBalances(userB);

    // Layer 1 for C — agent wallet credited, portfolio untouched
    expect(cAfter.agent).toBeGreaterThan(cBefore.agent);
    expect(cAfter.portfolio).toBe(cBefore.portfolio);

    // Layer 2 for B (if commission was above dust threshold)
    const { data: bComms } = await sb
      .from("referral_commissions")
      .select("commission_amount")
      .eq("referrer_id", userB)
      .eq("trader_id", dUserId)
      .eq("layer", 2);

    if (bComms && bComms.length > 0) {
      expect(bAfter.agent).toBeGreaterThan(bBefore.agent);
      expect(bAfter.portfolio).toBe(bBefore.portfolio);
    }
  });

  // ====================================================================
  // 6. Locked commission blocks transfer (migration 250)
  //
  // Seeds a referral_commissions row with unlock_at in the future and
  // confirms transfer_agent_to_portfolio rejects with the new error
  // message. This is the core guarantee of the monthly payout lock.
  // ====================================================================
  it("6. rejects transfer when balance is locked (unlock_at in future)", async () => {
    // Referrer is the locked-wallet agent. Trader is a counterparty.
    const referrerId = await createTestUser(sb, { agent_balance_usd: 100 });
    const traderId = await createTestUser(sb, {});
    const marketId = await createTestMarket(sb, referrerId);
    createdUsers.push(referrerId, traderId);
    createdMarkets.push(marketId);

    // Insert a locked commission for $100 — unlocks 30 days from now.
    const unlockAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await sb.from("referral_commissions").insert({
      referrer_id: referrerId,
      trader_id: traderId,
      market_id: marketId,
      trade_id: null,
      layer: 1,
      agent_level_at_time: 1,
      platform_revenue_amount: 1000,
      commission_rate: 0.1,
      commission_amount: 100,
      status: "credited",
      revenue_type: "trade",
      unlock_at: unlockAt,
    });

    // Authenticate AS the referrer so auth.uid() matches.
    const { client, userId, cleanup: authCleanup } =
      await createAuthenticatedClient(sb, {
        balance_usd: 0,
        agent_balance_usd: 100,
      });
    createdUsers.push(userId);
    authCleanups.push(authCleanup);

    // Move the locked commission to the authenticated test user.
    await sb
      .from("referral_commissions")
      .update({ referrer_id: userId })
      .eq("referrer_id", referrerId);

    // Attempt to transfer — should fail with the new lock error.
    const { error } = await client.rpc("transfer_agent_to_portfolio", {
      p_amount: 50,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("Insufficient unlocked balance");
    expect(error!.message).toContain("pending");
  });

  // ====================================================================
  // 7. Available-balance transfer succeeds when part is locked
  //
  // Agent has $100 total with $60 locked. Transferring $40 (== available)
  // should succeed. Transferring $50 should fail.
  // ====================================================================
  it("7. transfers available portion while pending is locked", async () => {
    const traderId = await createTestUser(sb, {});
    createdUsers.push(traderId);
    const { client, userId, cleanup: authCleanup } =
      await createAuthenticatedClient(sb, {
        balance_usd: 0,
        agent_balance_usd: 100,
      });
    createdUsers.push(userId);
    authCleanups.push(authCleanup);

    const marketId = await createTestMarket(sb, userId);
    createdMarkets.push(marketId);

    // Lock $60 of the $100 balance — 30 days out.
    const unlockAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await sb.from("referral_commissions").insert({
      referrer_id: userId,
      trader_id: traderId,
      market_id: marketId,
      trade_id: null,
      layer: 1,
      agent_level_at_time: 1,
      platform_revenue_amount: 600,
      commission_rate: 0.1,
      commission_amount: 60,
      status: "credited",
      revenue_type: "trade",
      unlock_at: unlockAt,
    });

    // $50 requested > $40 available → fail.
    const { error: overErr } = await client.rpc("transfer_agent_to_portfolio", {
      p_amount: 50,
    });
    expect(overErr).not.toBeNull();
    expect(overErr!.message).toContain("Insufficient unlocked balance");

    // $40 requested == available → succeed.
    const { data, error: okErr } = await client.rpc("transfer_agent_to_portfolio", {
      p_amount: 40,
    });
    expect(okErr).toBeNull();
    const result = data as unknown as {
      agent_balance_usd: number;
      balance_usd: number;
      available: number;
      pending: number;
    };
    expect(result.agent_balance_usd).toBe(60);
    expect(result.balance_usd).toBe(40);
    expect(result.pending).toBe(60);
    expect(result.available).toBe(0);
  });

  // ====================================================================
  // 8. get_agent_wallet_summary returns the correct split
  // ====================================================================
  it("8. get_agent_wallet_summary splits available and pending", async () => {
    const traderId = await createTestUser(sb, {});
    createdUsers.push(traderId);
    const { client, userId, cleanup: authCleanup } =
      await createAuthenticatedClient(sb, {
        balance_usd: 0,
        agent_balance_usd: 75,
      });
    createdUsers.push(userId);
    authCleanups.push(authCleanup);

    const marketId = await createTestMarket(sb, userId);
    createdMarkets.push(marketId);

    // $30 locked, $45 implicitly available (total - pending).
    const unlockAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await sb.from("referral_commissions").insert({
      referrer_id: userId,
      trader_id: traderId,
      market_id: marketId,
      trade_id: null,
      layer: 1,
      agent_level_at_time: 1,
      platform_revenue_amount: 300,
      commission_rate: 0.1,
      commission_amount: 30,
      status: "credited",
      revenue_type: "trade",
      unlock_at: unlockAt,
    });

    const { data, error } = await client.rpc("get_agent_wallet_summary");
    expect(error).toBeNull();
    const summary = data as unknown as {
      total: number;
      available: number;
      pending: number;
      next_unlock_at: string | null;
    };
    expect(Number(summary.total)).toBe(75);
    expect(Number(summary.available)).toBe(45);
    expect(Number(summary.pending)).toBe(30);
    expect(summary.next_unlock_at).not.toBeNull();
  });
});
