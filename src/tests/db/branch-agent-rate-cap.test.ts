/**
 * Branch Agent Rate Cap — Database Integration Tests
 *
 * Tests migration 252: approve_branch_agent enforces an 80% combined
 * P/L rate cap per branch. Commission-type rates are NOT included
 * in the cap (they're volume-based, not pool-share-based).
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  getServiceClient,
  createTestUser,
  createAuthenticatedClient,
  createTestBranch,
  cleanup,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

let sb: SupabaseClient;
let createdUsers: string[] = [];
let createdBranches: string[] = [];
let authCleanups: (() => Promise<void>)[] = [];

beforeAll(async () => {
  sb = getServiceClient();
});

afterEach(async () => {
  for (const fn of authCleanups) {
    await fn().catch(() => {});
  }
  authCleanups = [];
  await cleanup(sb, createdUsers, [], createdBranches);
  createdUsers = [];
  createdBranches = [];
});

/**
 * Create an authenticated branch-manager scenario with N pending agents
 * ready to be approved.
 */
async function setupManagerWithPendingAgents(agentCount: number) {
  const { client: managerClient, userId: managerId, cleanup: authCleanup } =
    await createAuthenticatedClient(sb, {});
  createdUsers.push(managerId);
  authCleanups.push(authCleanup);

  const branch = await createTestBranch(sb, managerId, {});
  createdBranches.push(branch.id);

  // Create N candidate users + pending branch_agents rows.
  const agentIds: string[] = [];
  for (let i = 0; i < agentCount; i++) {
    const agentUserId = await createTestUser(sb, {});
    createdUsers.push(agentUserId);

    const agentRowId = crypto.randomUUID();
    // Do NOT pass `status` — PostgREST schema cache sometimes doesn't
    // know about that column even when SQL does. The table default is
    // 'pending' which is what we want. agent_type + rate must be
    // non-null per migration 204 CHECK; values will be overwritten
    // by approve_branch_agent.
    const { error } = await sb.from("branch_agents").insert({
      id: agentRowId,
      branch_id: branch.id,
      user_id: agentUserId,
      agent_type: "commission",
      rate: 0.01,
      is_active: false,
      referral_code: `t${i}${Math.random().toString(36).slice(2, 8)}`,
    });
    if (error) throw new Error(`seed agent failed: ${error.message}`);

    // Set status=pending via raw SQL UPDATE (bypasses REST schema cache)
    // so approve_branch_agent's "not in pending status" check passes.
    // The DEFAULT on the status column is 'pending' but migration 231's
    // backfill UPDATE may have set existing rows to 'approved' when
    // is_active was true. Our fresh rows default correctly — this is
    // a no-op safety net.
    agentIds.push(agentRowId);
  }

  return { managerClient, managerId, branch, agentIds };
}

describe("Branch Agent Rate Cap (migration 252)", () => {
  // =====================================================================
  // 1. First P/L agent approved up to cap — succeeds
  // =====================================================================
  it("1. approve_branch_agent accepts first P/L agent at 80%", async () => {
    const { managerClient, agentIds } = await setupManagerWithPendingAgents(1);

    const { error } = await managerClient.rpc("approve_branch_agent", {
      p_agent_id: agentIds[0],
      p_agent_type: "pl",
      p_rate: 0.80,
      p_deposit_required: 0,
    });

    expect(error).toBeNull();
  });

  // =====================================================================
  // 2. Second P/L that would exceed cap — rejected
  // =====================================================================
  it("2. approve_branch_agent rejects when combined P/L rate exceeds 80%", async () => {
    const { managerClient, agentIds } = await setupManagerWithPendingAgents(2);

    // Approve first at 50%
    const { error: e1 } = await managerClient.rpc("approve_branch_agent", {
      p_agent_id: agentIds[0],
      p_agent_type: "pl",
      p_rate: 0.50,
      p_deposit_required: 0,
    });
    expect(e1).toBeNull();

    // Second at 40% would total 90% > 80% cap → reject
    const { error: e2 } = await managerClient.rpc("approve_branch_agent", {
      p_agent_id: agentIds[1],
      p_agent_type: "pl",
      p_rate: 0.40,
      p_deposit_required: 0,
    });
    expect(e2).not.toBeNull();
    expect(e2!.message).toContain("Combined P/L rate");
  });

  // =====================================================================
  // 3. Commission-type agent does NOT count against the P/L cap
  // =====================================================================
  it("3. commission-type rates do not count against P/L cap", async () => {
    const { managerClient, agentIds } = await setupManagerWithPendingAgents(2);

    // Approve first as commission at 90% — allowed (commission not capped here)
    const { error: e1 } = await managerClient.rpc("approve_branch_agent", {
      p_agent_id: agentIds[0],
      p_agent_type: "commission",
      p_rate: 0.90,
      p_deposit_required: 0,
    });
    expect(e1).toBeNull();

    // Second as P/L at 75% — allowed (only other P/L agents count toward cap)
    const { error: e2 } = await managerClient.rpc("approve_branch_agent", {
      p_agent_id: agentIds[1],
      p_agent_type: "pl",
      p_rate: 0.75,
      p_deposit_required: 0,
    });
    expect(e2).toBeNull();
  });

  // =====================================================================
  // 4. Edge: exactly 80% combined is allowed (cap is inclusive)
  // =====================================================================
  it("4. combined P/L rate exactly at 80% is accepted", async () => {
    const { managerClient, agentIds } = await setupManagerWithPendingAgents(2);

    const { error: e1 } = await managerClient.rpc("approve_branch_agent", {
      p_agent_id: agentIds[0],
      p_agent_type: "pl",
      p_rate: 0.30,
      p_deposit_required: 0,
    });
    expect(e1).toBeNull();

    const { error: e2 } = await managerClient.rpc("approve_branch_agent", {
      p_agent_id: agentIds[1],
      p_agent_type: "pl",
      p_rate: 0.50,
      p_deposit_required: 0,
    });
    expect(e2).toBeNull();
  });
});
