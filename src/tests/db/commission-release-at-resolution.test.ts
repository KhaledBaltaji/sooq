/**
 * Commission Release-at-Resolution — Database Integration Tests
 *
 * Covers the behavior change introduced in migrations 296 + 297:
 *   - Trade-time commissions on open markets land as status='pending' and
 *     do NOT increment agent_balance_usd
 *   - When the market resolves, the trigger sweeps pending → credited and
 *     increments agent_balance_usd
 *   - When the market voids, pending → voided with no balance movement
 *   - Resolution-time commissions still credit immediately
 *
 * Applies to ALL agents (retail + commission-branch + sub-agent). This
 * suite uses retail agents for brevity; the commission-branch tests in
 * commission-branch.test.ts pick up the same flow via their signup path.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getServiceClient,
  createTestUser,
  createTestMarket,
  createAuthenticatedClient,
  cleanup,
} from "./helpers";

let sb: SupabaseClient;
let createdUsers: string[] = [];
let createdMarkets: string[] = [];
const authCleanups: Array<() => Promise<void>> = [];

beforeAll(async () => {
  sb = getServiceClient();
});

afterEach(async () => {
  for (const fn of authCleanups.splice(0)) await fn().catch(() => {});
  await cleanup(sb, createdUsers, createdMarkets);
  createdUsers = [];
  createdMarkets = [];
});

// ============================================================================
// Helpers
// ============================================================================

async function getCommissionsForReferrer(referrerId: string) {
  const { data } = await sb
    .from("referral_commissions")
    .select("*")
    .eq("referrer_id", referrerId)
    .order("id", { ascending: true });
  return data ?? [];
}

async function getAgentBalance(userId: string): Promise<number> {
  const { data } = await sb
    .from("users")
    .select("agent_balance_usd")
    .eq("id", userId)
    .single();
  return Number(data?.agent_balance_usd ?? 0);
}

async function resolveMarket(marketId: string, outcome: "yes" | "no" = "yes") {
  await sb
    .from("markets")
    .update({ status: "resolved", outcome, resolved_at: new Date().toISOString() })
    .eq("id", marketId);
}

async function voidMarket(marketId: string) {
  await sb.from("markets").update({ status: "voided" }).eq("id", marketId);
}

// ============================================================================
// §1. Trade-time commission on OPEN market → pending, no balance change
// ============================================================================

describe("Commission release-at-resolution: trade on open market", () => {
  it("creates pending commission row, agent_balance_usd unchanged", async () => {
    const agentId = await createTestUser(sb, {
      agent_activation_override: true,
      agent_activated: true,
    });
    const marketAdmin = await createTestUser(sb, { is_admin: true });
    createdUsers.push(agentId, marketAdmin);

    const marketId = await createTestMarket(sb, marketAdmin);
    createdMarkets.push(marketId);

    const { client: referredClient, userId: referredId, cleanup: c1 } =
      await createAuthenticatedClient(sb, {
        referred_by: agentId,
        referral_chain: [agentId],
        balance_usd: 200,
      });
    createdUsers.push(referredId);
    authCleanups.push(c1);

    const balanceBefore = await getAgentBalance(agentId);
    await referredClient.rpc("execute_trade", { p_market_id: marketId, p_side: "yes", p_amount: 25 });

    const commissions = await getCommissionsForReferrer(agentId);
    expect(commissions.length).toBeGreaterThan(0);
    for (const c of commissions) {
      expect(c.status).toBe("pending");
      expect(c.market_id).toBe(marketId);
      expect(c.revenue_type).toBe("trade");
    }

    const balanceAfter = await getAgentBalance(agentId);
    expect(balanceAfter).toBe(balanceBefore);
  });
});

// ============================================================================
// §2. Market resolves → pending commissions flip to credited, balance updates
// ============================================================================

describe("Commission release-at-resolution: market resolves", () => {
  it("releases pending commissions to credited + balance on resolve", async () => {
    const agentId = await createTestUser(sb, {
      agent_activation_override: true,
      agent_activated: true,
    });
    const marketAdmin = await createTestUser(sb, { is_admin: true });
    createdUsers.push(agentId, marketAdmin);

    const marketId = await createTestMarket(sb, marketAdmin);
    createdMarkets.push(marketId);

    const { client: referredClient, userId: referredId, cleanup: c1 } =
      await createAuthenticatedClient(sb, {
        referred_by: agentId,
        referral_chain: [agentId],
        balance_usd: 500,
      });
    createdUsers.push(referredId);
    authCleanups.push(c1);

    await referredClient.rpc("execute_trade", { p_market_id: marketId, p_side: "yes", p_amount: 50 });

    const before = await getCommissionsForReferrer(agentId);
    expect(before.every((c) => c.status === "pending")).toBe(true);
    const balanceBefore = await getAgentBalance(agentId);

    await resolveMarket(marketId, "yes");

    const after = await getCommissionsForReferrer(agentId);
    expect(after.length).toBe(before.length);
    for (const c of after) {
      expect(c.status).toBe("credited");
    }

    const balanceAfter = await getAgentBalance(agentId);
    const totalCommission = before.reduce((s, c) => s + Number(c.commission_amount), 0);
    expect(balanceAfter).toBeCloseTo(balanceBefore + totalCommission, 2);
  });
});

// ============================================================================
// §3. Market voided → pending commissions flip to voided, no balance change
// ============================================================================

describe("Commission release-at-resolution: market voided", () => {
  it("sweeps pending commissions to voided with no balance change", async () => {
    const agentId = await createTestUser(sb, {
      agent_activation_override: true,
      agent_activated: true,
    });
    const marketAdmin = await createTestUser(sb, { is_admin: true });
    createdUsers.push(agentId, marketAdmin);

    const marketId = await createTestMarket(sb, marketAdmin);
    createdMarkets.push(marketId);

    const { client: referredClient, userId: referredId, cleanup: c1 } =
      await createAuthenticatedClient(sb, {
        referred_by: agentId,
        referral_chain: [agentId],
        balance_usd: 200,
      });
    createdUsers.push(referredId);
    authCleanups.push(c1);

    await referredClient.rpc("execute_trade", { p_market_id: marketId, p_side: "yes", p_amount: 25 });

    const before = await getCommissionsForReferrer(agentId);
    expect(before.every((c) => c.status === "pending")).toBe(true);
    const balanceBefore = await getAgentBalance(agentId);

    await voidMarket(marketId);

    const after = await getCommissionsForReferrer(agentId);
    for (const c of after) {
      expect(c.status).toBe("voided");
    }

    const balanceAfter = await getAgentBalance(agentId);
    expect(balanceAfter).toBe(balanceBefore);
  });
});

// ============================================================================
// §4. Resolving Market A doesn't affect Market B's pending commissions
// ============================================================================

describe("Commission release-at-resolution: scoping", () => {
  it("resolving one market does not release pendings on another", async () => {
    const agentId = await createTestUser(sb, {
      agent_activation_override: true,
      agent_activated: true,
    });
    const marketAdmin = await createTestUser(sb, { is_admin: true });
    createdUsers.push(agentId, marketAdmin);

    const marketA = await createTestMarket(sb, marketAdmin);
    const marketB = await createTestMarket(sb, marketAdmin);
    createdMarkets.push(marketA, marketB);

    const { client: referredClient, userId: referredId, cleanup: c1 } =
      await createAuthenticatedClient(sb, {
        referred_by: agentId,
        referral_chain: [agentId],
        balance_usd: 500,
      });
    createdUsers.push(referredId);
    authCleanups.push(c1);

    await referredClient.rpc("execute_trade", { p_market_id: marketA, p_side: "yes", p_amount: 25 });
    await referredClient.rpc("execute_trade", { p_market_id: marketB, p_side: "yes", p_amount: 25 });

    await resolveMarket(marketA, "yes");

    const commissions = await getCommissionsForReferrer(agentId);
    const aCommissions = commissions.filter((c) => c.market_id === marketA);
    const bCommissions = commissions.filter((c) => c.market_id === marketB);

    expect(aCommissions.length).toBeGreaterThan(0);
    expect(bCommissions.length).toBeGreaterThan(0);
    expect(aCommissions.every((c) => c.status === "credited")).toBe(true);
    expect(bCommissions.every((c) => c.status === "pending")).toBe(true);
  });
});
