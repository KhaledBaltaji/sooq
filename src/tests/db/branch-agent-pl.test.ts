/**
 * Branch P/L Settlement — Database Integration Tests
 *
 * Tests migration 252 (PR 3 of 3):
 *   - P/L-type agents earn at resolution based on per-referred-user pool P/L.
 *   - Commission formula: (pool_contribution + SOOQ fees added back) × rate.
 *   - Negative P/L debits cumulative_pl without writing a commission row.
 *   - transfer_agent_to_portfolio blocks when cumulative_pl < 0.
 *   - Commissions inherit PR 1 monthly lock via _credit_branch_pl.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  getServiceClient,
  createTestUser,
  createTestMarket,
  createAuthenticatedClient,
  createTestBranch,
  createTestBranchAgent,
  assignUserToBranch,
  fundBranchPool,
  cleanup,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

let sb: SupabaseClient;
let createdUsers: string[] = [];
let createdMarkets: string[] = [];
let createdBranches: string[] = [];
let authCleanups: (() => Promise<void>)[] = [];

beforeAll(async () => {
  sb = getServiceClient();
});

// 60s cleanup budget (default 30s) — under staging DB pressure from concurrent
// test runs, signing out accumulated auth users plus deleting branches +
// markets + users can brush past the 30s default.
afterEach(async () => {
  for (const fn of authCleanups) {
    await fn().catch(() => {});
  }
  authCleanups = [];
  await cleanup(sb, createdUsers, createdMarkets, createdBranches);
  createdUsers = [];
  createdMarkets = [];
  createdBranches = [];
}, 60000);

// ---------------------------------------------------------------------------
// Helper: build a P/L scenario, trade, then resolve on a given outcome
// ---------------------------------------------------------------------------

async function setupPLScenario(opts: {
  agentRate: number;
  agentActive?: boolean;
}) {
  const managerId = await createTestUser(sb, {});
  createdUsers.push(managerId);

  const branch = await createTestBranch(sb, managerId, {
    yes_markup_pct: 0.03,
    no_markup_pct: 0.03,
    branch_fee_rate: 0.0, // keep sooq_fee = 0 to simplify math in tests
  });
  createdBranches.push(branch.id);

  await fundBranchPool(sb, branch.id, 10000);

  const agentUserId = await createTestUser(sb, {});
  createdUsers.push(agentUserId);
  const agentId = await createTestBranchAgent(sb, branch.id, agentUserId, {
    agent_type: "pl",
    rate: opts.agentRate,
    is_active: opts.agentActive ?? true,
  });

  const market = await createTestMarket(sb, managerId);
  createdMarkets.push(market);

  const { client: traderClient, userId: traderId, cleanup: authCleanup } =
    await createAuthenticatedClient(sb, { balance_usd: 500 });
  createdUsers.push(traderId);
  authCleanups.push(authCleanup);

  await assignUserToBranch(sb, traderId, branch.id, agentId);

  return {
    managerId,
    branch,
    agentUserId,
    agentId,
    market,
    traderId,
    traderClient,
  };
}

async function getAgentBalance(userId: string): Promise<number> {
  const { data } = await sb
    .from("users")
    .select("agent_balance_usd")
    .eq("id", userId)
    .single();
  return Number((data as { agent_balance_usd: number } | null)?.agent_balance_usd ?? 0);
}

async function getCumulativePl(agentId: string): Promise<number> {
  const { data } = await sb
    .from("branch_agents")
    .select("cumulative_pl")
    .eq("id", agentId)
    .single();
  return Number((data as { cumulative_pl: number } | null)?.cumulative_pl ?? 0);
}

async function getPLCommissions(agentUserId: string) {
  const { data } = await sb
    .from("referral_commissions")
    .select("*")
    .eq("referrer_id", agentUserId)
    .eq("source_type", "branch_pl");
  return (data ?? []) as Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

describe("Branch P/L Settlement (migration 252)", () => {
  // =====================================================================
  // 1. Losing referred-user trade → branch pool gains → P/L agent earns
  // =====================================================================
  it("1. P/L agent earns when branch wins on referred-user's losing trade", async () => {
    const scenario = await setupPLScenario({ agentRate: 0.2 });

    // Trader buys YES $10. Market resolves NO → trader loses. Pool keeps the $10.
    const { error: buyErr } = await scenario.traderClient.rpc("execute_branch_trade", {
      p_market_id: scenario.market,
      p_branch_id: scenario.branch.id,
      p_side: "yes",
      p_amount: 10,
      p_shares_to_sell: null,
      p_idempotency_key: null,
    });
    expect(buyErr).toBeNull();

    // Resolve the market on NO (trader's position loses).
    const { error: resolveErr } = await sb.rpc("branch_settle_resolution", {
      p_market_id: scenario.market,
      p_outcome: "no",
    });
    expect(resolveErr).toBeNull();

    // Agent should have earned: (+$10 from trade_buy, no winners on this branch)
    // × 20% = $2.00. Commission recorded under source_type='branch_pl'.
    const pl = await getCumulativePl(scenario.agentId);
    expect(pl).toBeCloseTo(2.0, 2);

    const agentBalance = await getAgentBalance(scenario.agentUserId);
    expect(agentBalance).toBeCloseTo(2.0, 2);

    const comms = await getPLCommissions(scenario.agentUserId);
    expect(comms).toHaveLength(1);
    expect(comms[0].source_type).toBe("branch_pl");
    expect(comms[0].branch_id).toBe(scenario.branch.id);
    expect(comms[0].revenue_type).toBe("resolution");
    expect(Number(comms[0].commission_amount)).toBeCloseTo(2.0, 2);
  });

  // =====================================================================
  // 2. Winning referred-user trade → branch loses money → P/L agent loss
  // =====================================================================
  it("2. P/L agent absorbs losses when referred user wins (negative cumulative_pl)", async () => {
    const scenario = await setupPLScenario({ agentRate: 0.2 });

    const { error: buyErr } = await scenario.traderClient.rpc("execute_branch_trade", {
      p_market_id: scenario.market,
      p_branch_id: scenario.branch.id,
      p_side: "yes",
      p_amount: 10,
      p_shares_to_sell: null,
      p_idempotency_key: null,
    });
    expect(buyErr).toBeNull();

    // Resolve YES — trader wins. Pool pays out shares × (1 − fee).
    const { error: resolveErr } = await sb.rpc("branch_settle_resolution", {
      p_market_id: scenario.market,
      p_outcome: "yes",
    });
    expect(resolveErr).toBeNull();

    // Agent should have a NEGATIVE cumulative_pl because the branch lost.
    // Trade gained pool $10; resolution paid out > $10 (trader got shares
    // worth more than they paid). 20% of that net loss debits cumulative_pl.
    const pl = await getCumulativePl(scenario.agentId);
    expect(pl).toBeLessThan(0);

    // No commission row written for negative P/L.
    const comms = await getPLCommissions(scenario.agentUserId);
    expect(comms).toHaveLength(0);

    // Agent wallet balance unchanged (negative accrual doesn't credit).
    const agentBalance = await getAgentBalance(scenario.agentUserId);
    expect(agentBalance).toBe(0);
  });

  // =====================================================================
  // 3. transfer_agent_to_portfolio blocks on negative cumulative_pl
  // =====================================================================
  it("3. transfer_agent_to_portfolio rejects user with negative cumulative_pl", async () => {
    const scenario = await setupPLScenario({ agentRate: 0.2 });

    // Force-seed a negative cumulative_pl (simulates prior losing market).
    await sb
      .from("branch_agents")
      .update({ cumulative_pl: -50 })
      .eq("id", scenario.agentId);

    // Also seed some agent_balance_usd so the lock-check isn't the blocker.
    await sb
      .from("users")
      .update({ agent_balance_usd: 100 })
      .eq("id", scenario.agentUserId);

    // Authenticate AS the agent user.
    const { client: agentClient, userId: authUid, cleanup: authCleanup } =
      await createAuthenticatedClient(sb, {
        balance_usd: 0,
        agent_balance_usd: 100,
      });
    createdUsers.push(authUid);
    authCleanups.push(authCleanup);

    // Move the agent row to the newly-authenticated user id so the RPC's
    // auth.uid() matches a row with negative cumulative_pl.
    await sb
      .from("branch_agents")
      .update({ user_id: authUid })
      .eq("id", scenario.agentId);

    const { error } = await agentClient.rpc("transfer_agent_to_portfolio", {
      p_amount: 10,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("P/L debt outstanding");
  });

  // =====================================================================
  // 4. Inactive P/L agent earns nothing
  // =====================================================================
  it("4. inactive P/L agent does not accrue on resolution", async () => {
    const scenario = await setupPLScenario({ agentRate: 0.2, agentActive: false });

    const { error: buyErr } = await scenario.traderClient.rpc("execute_branch_trade", {
      p_market_id: scenario.market,
      p_branch_id: scenario.branch.id,
      p_side: "yes",
      p_amount: 10,
      p_shares_to_sell: null,
      p_idempotency_key: null,
    });
    expect(buyErr).toBeNull();

    const { error: resolveErr } = await sb.rpc("branch_settle_resolution", {
      p_market_id: scenario.market,
      p_outcome: "no",
    });
    expect(resolveErr).toBeNull();

    expect(await getCumulativePl(scenario.agentId)).toBe(0);
    expect(await getAgentBalance(scenario.agentUserId)).toBe(0);
    expect(await getPLCommissions(scenario.agentUserId)).toHaveLength(0);
  });

  // =====================================================================
  // 5. P/L commission respects PR 1 monthly unlock
  // =====================================================================
  it("5. P/L commission row has unlock_at set per fee_config", async () => {
    const scenario = await setupPLScenario({ agentRate: 0.2 });

    await scenario.traderClient.rpc("execute_branch_trade", {
      p_market_id: scenario.market,
      p_branch_id: scenario.branch.id,
      p_side: "yes",
      p_amount: 10,
      p_shares_to_sell: null,
      p_idempotency_key: null,
    });

    await sb.rpc("branch_settle_resolution", {
      p_market_id: scenario.market,
      p_outcome: "no",
    });

    const comms = await getPLCommissions(scenario.agentUserId);
    expect(comms).toHaveLength(1);

    const { data: flag } = await sb
      .from("fee_config")
      .select("rate")
      .eq("fee_type", "commission_hold_enabled")
      .single();
    const holdEnabled = Number((flag as { rate: number } | null)?.rate ?? 0);

    if (holdEnabled > 0) {
      expect(comms[0].unlock_at).not.toBeNull();
      const unlockTs = new Date(comms[0].unlock_at as string).getTime();
      expect(unlockTs).toBeGreaterThan(Date.now());
    } else {
      expect(comms[0].unlock_at).toBeNull();
    }
  });
});
