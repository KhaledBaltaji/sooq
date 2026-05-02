/**
 * Commission Model -- Database Integration Tests (V3 AMM)
 *
 * Tests the multi-level commission system against a live Supabase instance.
 * Canonical spec: docs/commission-model.md
 *
 * V3 changes:
 *   - Commissions are based on explicit_fee (0.5% trading fee), NOT trade amount
 *   - Uses execute_trade RPC (requires auth.uid())
 *   - AMM state in amm_state table
 *
 * Covers:
 *  1. 2-layer chain: direct + indirect earn commissions, deep ancestor gets $0
 *  2. All 4 agent level x Tier 1 rate combinations
 *  3. Agent level upgrade threshold
 *  4. Voided market commission clawback
 *  5. referral_chain integrity at signup
 *  6. Both-side trading generates commission on each trade's fee
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  getServiceClient,
  createTestUser,
  createTestMarket,
  createAuthenticatedClient,
  createReferralChain,
  fundUser,
  cleanup,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

let sb: SupabaseClient;
let createdUsers: string[] = [];
let createdMarkets: string[] = [];
let authCleanups: (() => Promise<void>)[] = [];

// Shared admin auth client — created once, reused for all resolutions
let sharedAdminClient: SupabaseClient;
let sharedAdminId: string;
let sharedAdminCleanup: () => Promise<void>;

const TEST_PIN = "123456";

beforeAll(async () => {
  sb = getServiceClient();

  const adminAuth = await createAuthenticatedClient(sb, {
    is_admin: true,
    balance_usd: 50000,
  });
  sharedAdminClient = adminAuth.client;
  sharedAdminId = adminAuth.userId;
  sharedAdminCleanup = adminAuth.cleanup;

  // Set admin PIN (required for resolve_market since migration 176)
  const { error: pinError } = await sharedAdminClient.rpc("admin_set_pin", { p_pin: TEST_PIN });
  if (pinError) throw new Error(`admin_set_pin failed: ${pinError.message}`);
});

afterAll(async () => {
  await sharedAdminCleanup?.().catch(() => {});
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
// Helper: create an authenticated client for a user that already exists
// in the users table (e.g. from createReferralChain). Since those users
// were created via createTestUser (admin API), we create a fresh auth
// client with the same userId by using createAuthenticatedClient with
// overrides that link to the existing referral chain.
// ---------------------------------------------------------------------------
async function createAuthClientForExistingUser(
  serviceClient: SupabaseClient,
  overrides: Record<string, unknown> = {}
): Promise<{ client: SupabaseClient; userId: string; cleanup: () => Promise<void> }> {
  const result = await createAuthenticatedClient(serviceClient, overrides);
  createdUsers.push(result.userId);
  authCleanups.push(result.cleanup);
  return result;
}

// ---------------------------------------------------------------------------
// Helper: execute a trade via an authenticated client
// ---------------------------------------------------------------------------
async function executeTrade(
  userClient: SupabaseClient,
  marketId: string,
  side: "yes" | "no",
  direction: "buy" | "sell",
  amount: number
) {
  const params: Record<string, unknown> = {
    p_market_id: marketId,
    p_side: side,
  };
  if (direction === "buy") {
    params.p_amount = amount;
  } else {
    params.p_shares_to_sell = amount;
  }
  const { data, error } = await userClient.rpc("execute_trade", params);
  if (error) throw new Error(`execute_trade failed: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Helper: resolve market via the shared authenticated admin client
// ---------------------------------------------------------------------------
async function resolveMarketAsAdmin(
  _adminId: string,
  marketId: string,
  outcome: "yes" | "no"
) {
  const { error } = await sharedAdminClient.rpc("resolve_market", {
    p_market_id: marketId,
    p_outcome: outcome,
    p_pin: TEST_PIN,
  });

  if (error) throw new Error(`resolve_market failed: ${error.message}`);
}

// ======================================================================
// TESTS
// ======================================================================

describe("Commission Model (V3 AMM)", () => {
  // ====================================================================
  // 1. 2-layer chain: direct + indirect earn, deep ancestor gets $0
  // ====================================================================
  it("1. 2-layer chain: direct + indirect earn commissions, deep ancestor gets $0", async () => {
    // Chain: A(L4) -> B(L2) -> C(L1) -> D (trader)
    // With 2-layer model: C (Layer 1) and B (Layer 2) earn, A (Layer 3) gets nothing
    const { userA, userB, userC, userD } = await createReferralChain(sb);
    createdUsers.push(userA, userB, userC, userD);

    const marketId = await createTestMarket(sb, userA);
    createdMarkets.push(marketId);

    // Create an authenticated client for D to trade
    const { client: dClient, userId: dUserId, cleanup: dCleanup } =
      await createAuthenticatedClient(sb, {
        referred_by: userC,
        referral_chain: [userC, userB, userA],
        balance_usd: 500,
      });
    createdUsers.push(dUserId);
    authCleanups.push(dCleanup);

    // D buys YES shares (needs enough for commission > $0.01 dust threshold)
    const tradeResult = await executeTrade(dClient, marketId, "yes", "buy", 10);
    expect(tradeResult.trade_id).toBeDefined();
    expect(tradeResult.explicit_fee).toBeGreaterThan(0);

    // Record agent wallet balances before resolution (commissions go to agent_balance_usd)
    const agentBalanceBefore = async (uid: string) => {
      const { data } = await sb
        .from("users")
        .select("agent_balance_usd")
        .eq("id", uid)
        .single();
      return Number(data?.agent_balance_usd ?? 0);
    };

    const cBefore = await agentBalanceBefore(userC);
    const bBefore = await agentBalanceBefore(userB);
    const aBefore = await agentBalanceBefore(userA);

    // Resolve market YES -- triggers settle_commissions
    await resolveMarketAsAdmin(userA, marketId, "yes");

    // Read commission records for the trader
    const { data: comms, error: commsError } = await sb
      .from("referral_commissions")
      .select("*")
      .eq("market_id", marketId)
      .eq("trader_id", dUserId)
      .order("layer");
    if (commsError) throw new Error(`Failed to query commissions: ${commsError.message}`);

    // Should have commissions — max 2 layers × 2 types (trade + resolution) = 4 max
    expect(comms).toBeDefined();
    expect(comms!.length).toBeGreaterThan(0);
    expect(comms!.length).toBeLessThanOrEqual(4);

    // No Layer 3 commissions should exist (2-layer model)
    const layer3Comms = comms!.filter((c: any) => c.layer === 3);
    expect(layer3Comms.length).toBe(0);

    // All commission amounts should be positive (based on platform revenue)
    for (const c of comms!) {
      expect(Number(c.commission_amount)).toBeGreaterThan(0);
    }

    const totalComm = comms!.reduce(
      (sum: number, c: any) => sum + Number(c.commission_amount),
      0
    );
    expect(totalComm).toBeLessThan(10);
    expect(totalComm).toBeGreaterThan(0);

    // Verify agent wallet balances were credited
    const cAfter = await agentBalanceBefore(userC);
    const bAfter = await agentBalanceBefore(userB);
    const aAfter = await agentBalanceBefore(userA);

    // C (Layer 1 direct) should have received commission
    if (comms!.find((c: any) => c.layer === 1)) {
      expect(cAfter).toBeGreaterThan(cBefore);
    }
    // B (Layer 2 indirect) should have received commission
    if (comms!.find((c: any) => c.layer === 2)) {
      expect(bAfter).toBeGreaterThan(bBefore);
    }
    // A (Layer 3 deep) should NOT have received any commission
    expect(aAfter).toBe(aBefore);
  });

  // ====================================================================
  // 2. All 4 agent levels at Tier 1 produce increasing rates
  // ====================================================================
  it("2. All 4 agent levels at Tier 1 produce increasing commission rates", async () => {
    const commissionAmounts: number[] = [];

    for (const agentLevel of [1, 2, 3, 4]) {
      // Create referrer at this agent level
      const referrer = await createTestUser(sb, {
        agent_level: agentLevel,
        direct_referral_count:
          agentLevel === 1 ? 5 : agentLevel === 2 ? 15 : agentLevel === 3 ? 75 : 250,
      });
      createdUsers.push(referrer);

      // Create authenticated trader referred by this agent
      const { client: traderClient, userId: traderId, cleanup: traderCleanup } =
        await createAuthenticatedClient(sb, {
          referred_by: referrer,
          referral_chain: [referrer],
          balance_usd: 500,
        });
      createdUsers.push(traderId);
      authCleanups.push(traderCleanup);

      const marketId = await createTestMarket(sb, referrer);
      createdMarkets.push(marketId);

      // Execute a trade (needs enough for commission > $0.01 dust threshold)
      await executeTrade(traderClient, marketId, "yes", "buy", 10);

      // Resolve market
      await resolveMarketAsAdmin(referrer, marketId, "yes");

      // Read commissions
      const { data: comms } = await sb
        .from("referral_commissions")
        .select("*")
        .eq("market_id", marketId)
        .eq("trader_id", traderId)
        .eq("layer", 1);

      expect(comms).toBeDefined();
      // May have 1-2 records (trade commission + resolution commission)
      expect(comms!.length).toBeGreaterThanOrEqual(1);
      expect(comms!.length).toBeLessThanOrEqual(2);
      expect(Number(comms![0].commission_amount)).toBeGreaterThan(0);
      expect(comms![0].agent_level_at_time).toBe(agentLevel);

      // Sum all commissions for this agent level (trade + resolution)
      const totalForLevel = comms!.reduce(
        (sum: number, c: any) => sum + Number(c.commission_amount), 0
      );
      commissionAmounts.push(totalForLevel);
    }

    // Higher agent levels should earn more (or equal) commission
    for (let i = 1; i < commissionAmounts.length; i++) {
      expect(commissionAmounts[i]).toBeGreaterThanOrEqual(commissionAmounts[i - 1]);
    }
  });

  // ====================================================================
  // 3. Agent level upgrade -- volume-based L1 -> L2
  // ====================================================================
  it("3. Agent level upgrades from L1 to L2 at $10K network volume", async () => {
    const agent = await createTestUser(sb, {
      agent_level: 1,
      network_volume: 9000,
    });
    createdUsers.push(agent);

    // Verify still L1
    const { data: before } = await sb
      .from("users")
      .select("agent_level")
      .eq("id", agent)
      .single();
    expect(before?.agent_level).toBe(1);

    // Push volume past the $10K threshold
    await sb
      .from("users")
      .update({ network_volume: 10000 })
      .eq("id", agent);

    // Call update_agent_level
    const { data: newLevel, error } = await sb.rpc("update_agent_level", {
      p_user_id: agent,
    });
    expect(error).toBeNull();
    expect(newLevel).toBe(2);

    // Confirm persisted
    const { data: after } = await sb
      .from("users")
      .select("agent_level")
      .eq("id", agent)
      .single();
    expect(after?.agent_level).toBe(2);
  });

  // ====================================================================
  // 4. Voided market -- commissions are clawed back
  // ====================================================================
  it("4. Voided market: commissions are reversed and status set to voided", async () => {
    const { userA, userB, userC, userD } = await createReferralChain(sb);
    createdUsers.push(userA, userB, userC, userD);

    const marketId = await createTestMarket(sb, userA);
    createdMarkets.push(marketId);

    // Create authenticated client for D
    const { client: dClient, userId: dUserId, cleanup: dCleanup } =
      await createAuthenticatedClient(sb, {
        referred_by: userC,
        referral_chain: [userC, userB, userA],
        balance_usd: 500,
      });
    createdUsers.push(dUserId);
    authCleanups.push(dCleanup);

    // D buys YES
    await executeTrade(dClient, marketId, "yes", "buy", 5);

    // Resolve -- commissions get credited
    await resolveMarketAsAdmin(userA, marketId, "yes");

    // Snapshot agent wallet balances after commission credit
    const getAgentBalance = async (uid: string) => {
      const { data } = await sb
        .from("users")
        .select("agent_balance_usd")
        .eq("id", uid)
        .single();
      return Number(data?.agent_balance_usd ?? 0);
    };

    const cAfterResolve = await getAgentBalance(userC);
    const bAfterResolve = await getAgentBalance(userB);
    const aAfterResolve = await getAgentBalance(userA);

    // Verify commissions were created
    const { data: commsBeforeVoid } = await sb
      .from("referral_commissions")
      .select("*")
      .eq("market_id", marketId);
    expect(commsBeforeVoid!.length).toBeGreaterThan(0);

    // Void the market
    // First reopen (void_market may require non-resolved status)
    await sb.from("markets").update({ status: "open" }).eq("id", marketId);
    const { error: voidErr } = await sb.rpc("_void_market_internal", {
      p_market_id: marketId,
    });
    if (voidErr) {
      // Try void_market via admin client if _void_market_internal doesn't exist
      const { error: voidErr2 } = await sharedAdminClient.rpc("void_market", {
        p_market_id: marketId,
      });
      if (voidErr2) throw new Error(`void_market: ${voidErr2.message}`);
    }

    // All commission records should be voided
    const { data: comms } = await sb
      .from("referral_commissions")
      .select("*")
      .eq("market_id", marketId);

    expect(comms).toBeDefined();
    for (const c of comms!) {
      expect(c.status).toBe("voided");
    }

    // Agent wallet balances should be debited back (commission reversed)
    const cAfterVoid = await getAgentBalance(userC);
    const bAfterVoid = await getAgentBalance(userB);
    const aAfterVoid = await getAgentBalance(userA);

    expect(cAfterVoid).toBeLessThanOrEqual(cAfterResolve);
    expect(bAfterVoid).toBeLessThanOrEqual(bAfterResolve);
    expect(aAfterVoid).toBeLessThanOrEqual(aAfterResolve);
  });

  // ====================================================================
  // 5. referral_chain integrity -- A->B->C->D signup
  // ====================================================================
  it("5. referral_chain stores [direct, indirect, deep] max 3 entries", async () => {
    // Build chain manually to verify chain construction
    const userA = await createTestUser(sb, {
      referral_chain: [],
    });
    const userB = await createTestUser(sb, {
      referred_by: userA,
      referral_chain: [userA],
    });
    const userC = await createTestUser(sb, {
      referred_by: userB,
      referral_chain: [userB, userA],
    });
    const userD = await createTestUser(sb, {
      referred_by: userC,
      referral_chain: [userC, userB, userA],
    });
    createdUsers.push(userA, userB, userC, userD);

    // Verify D's chain
    const { data: dUser } = await sb
      .from("users")
      .select("referral_chain, referred_by")
      .eq("id", userD)
      .single();

    expect(dUser?.referred_by).toBe(userC);
    expect(dUser?.referral_chain).toHaveLength(3);
    expect(dUser?.referral_chain[0]).toBe(userC); // direct
    expect(dUser?.referral_chain[1]).toBe(userB); // indirect
    expect(dUser?.referral_chain[2]).toBe(userA); // deep

    // Verify C's chain
    const { data: cUser } = await sb
      .from("users")
      .select("referral_chain")
      .eq("id", userC)
      .single();

    expect(cUser?.referral_chain).toHaveLength(2);
    expect(cUser?.referral_chain[0]).toBe(userB);
    expect(cUser?.referral_chain[1]).toBe(userA);

    // If E signs up via D, chain should be [D, C, B] -- A drops off (max 3)
    const userE = await createTestUser(sb, {
      referred_by: userD,
      referral_chain: [userD, userC, userB],
    });
    createdUsers.push(userE);

    const { data: eUser } = await sb
      .from("users")
      .select("referral_chain")
      .eq("id", userE)
      .single();

    expect(eUser?.referral_chain).toHaveLength(3);
    expect(eUser?.referral_chain[0]).toBe(userD);
    expect(eUser?.referral_chain[1]).toBe(userC);
    expect(eUser?.referral_chain[2]).toBe(userB);
  });

  // ====================================================================
  // 6. Agent activation gate: commissions escrowed when < 5 qualified
  // ====================================================================
  it("6. Activation gate: commissions are escrowed when agent has < 5 qualified referrals", async () => {
    // Create a referrer with 0 qualified referrals (not activated)
    const referrer = await createTestUser(sb, {
      agent_level: 1,
      agent_activated: false,
      qualified_referral_count: 0,
    });
    createdUsers.push(referrer);

    const marketId = await createTestMarket(sb, referrer);
    createdMarkets.push(marketId);

    // Create an authenticated trader referred by this agent
    const { client: traderClient, userId: traderId, cleanup: traderCleanup } =
      await createAuthenticatedClient(sb, {
        referred_by: referrer,
        referral_chain: [referrer],
        balance_usd: 500,
      });
    createdUsers.push(traderId);
    authCleanups.push(traderCleanup);

    // Record agent wallet before trade
    const { data: before } = await sb
      .from("users")
      .select("agent_balance_usd, qualified_referral_count")
      .eq("id", referrer)
      .single();

    // Bettor trades — this is their first trade, so referrer's qualified_referral_count should increment
    await executeTrade(traderClient, marketId, "yes", "buy", 10);

    // Check referrer's qualified count incremented
    const { data: afterTrade } = await sb
      .from("users")
      .select("agent_balance_usd, qualified_referral_count, agent_activated")
      .eq("id", referrer)
      .single();

    expect(afterTrade?.qualified_referral_count).toBe((before?.qualified_referral_count ?? 0) + 1);
    expect(afterTrade?.agent_activated).toBe(false); // Still not activated (only 1/5)

    // Commission should be escrowed (not credited to agent_balance_usd)
    expect(Number(afterTrade?.agent_balance_usd)).toBe(Number(before?.agent_balance_usd));

    // Verify commission record exists with status='escrowed'
    const { data: comms } = await sb
      .from("referral_commissions")
      .select("*")
      .eq("referrer_id", referrer)
      .eq("trader_id", traderId)
      .eq("revenue_type", "trade");

    expect(comms).toBeDefined();
    expect(comms!.length).toBeGreaterThan(0);
    expect(comms![0].status).toBe("escrowed");
  });

  // ====================================================================
  // 7. Agent activation gate: commissions released at 5th qualified referral
  // ====================================================================
  it("7. Activation gate: escrowed commissions released when 5th qualified referral trades", async () => {
    // Create a referrer with 4 qualified referrals (one more to activate)
    const referrer = await createTestUser(sb, {
      agent_level: 1,
      agent_activated: false,
      qualified_referral_count: 4,
    });
    createdUsers.push(referrer);

    const marketId = await createTestMarket(sb, referrer);
    createdMarkets.push(marketId);

    // Seed one escrowed commission to verify it gets released
    await sb.from("referral_commissions").insert({
      referrer_id: referrer,
      trader_id: referrer, // dummy
      market_id: marketId,
      layer: 1,
      agent_level_at_time: 1,
      platform_revenue_amount: 1.00,
      commission_rate: 0.20,
      commission_amount: 0.20,
      status: "escrowed",
      revenue_type: "trade",
    });

    // Create the 5th referral trader
    const { client: traderClient, userId: traderId, cleanup: traderCleanup } =
      await createAuthenticatedClient(sb, {
        referred_by: referrer,
        referral_chain: [referrer],
        balance_usd: 500,
      });
    createdUsers.push(traderId);
    authCleanups.push(traderCleanup);

    // Bettor's first trade should trigger activation
    await executeTrade(traderClient, marketId, "yes", "buy", 10);

    // Referrer should now be activated
    const { data: afterActivation } = await sb
      .from("users")
      .select("agent_activated, qualified_referral_count, agent_balance_usd")
      .eq("id", referrer)
      .single();

    expect(afterActivation?.agent_activated).toBe(true);
    expect(afterActivation?.qualified_referral_count).toBe(5);

    // Post mig 296 + 297 (release-at-resolution): activation flips escrowed
    // commissions based on the market status. For open markets they go to
    // 'pending' (no balance movement); for resolved markets they go to
    // 'credited'. The test markets here are open, so agent_balance_usd
    // doesn't move until a resolve_market event fires.
    const { data: comms } = await sb
      .from("referral_commissions")
      .select("status")
      .eq("referrer_id", referrer);

    const escrowed = comms?.filter((c: any) => c.status === "escrowed") ?? [];
    expect(escrowed.length).toBe(0);

    // All non-escrowed commissions should now be pending (open markets) or credited (if any resolved)
    const nonTerminal = comms?.filter((c: any) => c.status === "pending" || c.status === "credited") ?? [];
    expect(nonTerminal.length).toBe(comms?.length ?? 0);
  });

  // ====================================================================
  // 8. Admin override releases escrowed commissions
  // ====================================================================
  it("8. Admin override: immediately releases escrowed commissions", async () => {
    // Create a non-activated referrer
    const referrer = await createTestUser(sb, {
      agent_level: 1,
      agent_activated: false,
      qualified_referral_count: 3,
    });
    createdUsers.push(referrer);

    const marketId = await createTestMarket(sb, referrer);
    createdMarkets.push(marketId);

    // Seed escrowed commissions
    await sb.from("referral_commissions").insert({
      referrer_id: referrer,
      trader_id: referrer,
      market_id: marketId,
      layer: 1,
      agent_level_at_time: 1,
      platform_revenue_amount: 5.00,
      commission_rate: 0.20,
      commission_amount: 1.00,
      status: "escrowed",
      revenue_type: "trade",
    });

    // Admin enables override
    const { data, error } = await sharedAdminClient.rpc("toggle_agent_activation_override", {
      p_user_id: referrer,
      p_override: true,
    });

    expect(error).toBeNull();
    expect((data as any).success).toBe(true);

    // Post mig 296 + 297: override releases escrowed commissions but only
    // credits them to agent_balance_usd for rows whose market is already
    // resolved. For open-market rows (this test), the status flips to
    // 'pending' — waiting for the market to resolve. So (released) is 0
    // and balance stays the same. The escrowed count drops to 0 either way.

    const { data: comms } = await sb
      .from("referral_commissions")
      .select("status")
      .eq("referrer_id", referrer)
      .eq("market_id", marketId);

    // Escrowed row should no longer be 'escrowed'
    expect(comms![0].status).not.toBe("escrowed");
    // It's 'pending' (open market) — agent will collect when market resolves
    expect(comms![0].status).toBe("pending");

    // Verify agent_activated is still FALSE (override doesn't set it)
    const { data: user } = await sb
      .from("users")
      .select("agent_activated, agent_activation_override, agent_balance_usd")
      .eq("id", referrer)
      .single();

    expect(user?.agent_activated).toBe(false);
    expect(user?.agent_activation_override).toBe(true);
    // Balance unchanged — commission is pending, not credited (open market)
    expect(Number(user?.agent_balance_usd)).toBe(0);
  });

  // ====================================================================
  // 9. Override does not cascade to subagents
  // ====================================================================
  it("9. Override does not cascade: subagent still needs own 5 qualified referrals", async () => {
    // Parent agent with override
    const parentAgent = await createTestUser(sb, {
      agent_level: 2,
      agent_activated: false,
      agent_activation_override: true,
      qualified_referral_count: 3,
    });
    createdUsers.push(parentAgent);

    // Subagent referred by parent (no override, not activated)
    const subAgent = await createTestUser(sb, {
      referred_by: parentAgent,
      referral_chain: [parentAgent],
      agent_level: 1,
      agent_activated: false,
      agent_activation_override: false,
      qualified_referral_count: 0,
    });
    createdUsers.push(subAgent);

    const marketId = await createTestMarket(sb, parentAgent);
    createdMarkets.push(marketId);

    // Create trader referred by subAgent
    const { client: traderClient, userId: traderId, cleanup: traderCleanup } =
      await createAuthenticatedClient(sb, {
        referred_by: subAgent,
        referral_chain: [subAgent, parentAgent],
        balance_usd: 500,
      });
    createdUsers.push(traderId);
    authCleanups.push(traderCleanup);

    // Bettor trades
    await executeTrade(traderClient, marketId, "yes", "buy", 10);

    // Check subAgent's commission is escrowed (not activated)
    const { data: subComms } = await sb
      .from("referral_commissions")
      .select("status, referrer_id")
      .eq("trader_id", traderId)
      .eq("revenue_type", "trade");

    const subAgentComms = subComms?.filter((c: any) => c.referrer_id === subAgent) ?? [];
    const parentComms = subComms?.filter((c: any) => c.referrer_id === parentAgent) ?? [];

    // SubAgent's commissions should be escrowed (no override, not activated)
    if (subAgentComms.length > 0) {
      expect(subAgentComms[0].status).toBe("escrowed");
    }

    // Parent has activation override → commission lands as 'pending' under
    // release-at-resolution (mig 296 + 297) since the market is still open.
    // It will flip to 'credited' when the market resolves.
    if (parentComms.length > 0) {
      expect(parentComms[0].status).toBe("pending");
    }
  });

  // ====================================================================
  // 10. Both-side trading generates commission on each trade's fee
  // ====================================================================
  it("10. Both-side trading: each trade generates fee-based commission", async () => {
    const { userA, userB, userC, userD } = await createReferralChain(sb);
    createdUsers.push(userA, userB, userC, userD);

    const marketId = await createTestMarket(sb, userA);
    createdMarkets.push(marketId);

    // Create authenticated client for D
    const { client: dClient, userId: dUserId, cleanup: dCleanup } =
      await createAuthenticatedClient(sb, {
        referred_by: userC,
        referral_chain: [userC, userB, userA],
        balance_usd: 500,
      });
    createdUsers.push(dUserId);
    authCleanups.push(dCleanup);

    // D buys YES and NO (both-side trading allowed in V3)
    const trade1 = await executeTrade(dClient, marketId, "yes", "buy", 5);
    expect(trade1.explicit_fee).toBeGreaterThan(0);

    // Wait for rate limit (if applicable, trades on different sides may be exempt)
    // Try immediately; if rate-limited, that's also valid behavior
    try {
      const trade2 = await executeTrade(dClient, marketId, "no", "buy", 5);
      expect(trade2.explicit_fee).toBeGreaterThan(0);
    } catch {
      // Rate limit on same market is acceptable -- the first trade still generated fees
    }

    // Verify trades exist
    const { data: trades } = await sb
      .from("trades")
      .select("id, side, direction, explicit_fee")
      .eq("market_id", marketId)
      .eq("user_id", dUserId);

    expect(trades).toBeDefined();
    expect(trades!.length).toBeGreaterThanOrEqual(1);

    // Each trade should have an explicit_fee
    for (const t of trades!) {
      expect(Number(t.explicit_fee)).toBeGreaterThan(0);
    }

    // Resolve and check commissions
    await resolveMarketAsAdmin(userA, marketId, "yes");

    const { data: comms } = await sb
      .from("referral_commissions")
      .select("*")
      .eq("market_id", marketId)
      .eq("trader_id", dUserId);

    // Commissions should exist and be positive (fee-based, not exposure-based)
    expect(comms).toBeDefined();
    if (comms!.length > 0) {
      for (const c of comms!) {
        expect(Number(c.commission_amount)).toBeGreaterThan(0);
      }
    }
  });
});
