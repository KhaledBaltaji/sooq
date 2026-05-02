/**
 * Branch Owner Operations — Database Integration Tests
 *
 * Tests migration 252 + 260:
 *   - get_branch_owner_summary returns pool health + agents + liabilities
 *   - Only branch managers can call get_branch_owner_summary
 *   - Owner-initiated withdrawal RPC was removed in migration 260
 *     (transfer_branch_pool_to_owner_portfolio) — pool is admin-controlled
 *     via admin_adjust_branch_pool.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  getServiceClient,
  createTestUser,
  createAuthenticatedClient,
  createTestBranch,
  fundBranchPool,
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
 * Scenario: authenticated user is the branch manager of a freshly-funded
 * branch with $1000 pool and no agents / liabilities.
 */
async function setupManagerScenario(opts?: { poolFunding?: number; status?: string }) {
  const { client: managerClient, userId: managerId, cleanup: authCleanup } =
    await createAuthenticatedClient(sb, { balance_usd: 0 });
  createdUsers.push(managerId);
  authCleanups.push(authCleanup);

  const branch = await createTestBranch(sb, managerId, {
    status: opts?.status ?? "active",
  });
  createdBranches.push(branch.id);

  await fundBranchPool(sb, branch.id, opts?.poolFunding ?? 1000);

  return { managerClient, managerId, branch };
}

describe("Branch Owner Operations (migrations 252 + 260)", () => {
  // =====================================================================
  // 1. get_branch_owner_summary — happy path
  // =====================================================================
  it("1. get_branch_owner_summary returns pool health and empty agents list", async () => {
    const { managerClient, branch } = await setupManagerScenario({ poolFunding: 5000 });

    const { data, error } = await managerClient.rpc("get_branch_owner_summary", {
      p_branch_id: branch.id,
    });

    expect(error).toBeNull();
    const summary = data as {
      branch_id: string;
      pool_balance: number;
      worst_case_total: number;
      pending_liabilities: number;
      effective_pool: number;
      solvency_status: string;
      agents: Array<unknown>;
    };

    expect(summary.branch_id).toBe(branch.id);
    expect(Number(summary.pool_balance)).toBe(5000);
    expect(Number(summary.pending_liabilities)).toBe(0);
    expect(summary.solvency_status).toBe("healthy");
    expect(summary.agents).toEqual([]);
  });

  // =====================================================================
  // 2. get_branch_owner_summary — non-manager blocked
  // =====================================================================
  it("2. get_branch_owner_summary rejects non-manager callers", async () => {
    const { branch } = await setupManagerScenario();

    // Different authenticated user who is NOT the branch manager
    const { client: intruderClient, userId: intruderId, cleanup: iCleanup } =
      await createAuthenticatedClient(sb, {});
    createdUsers.push(intruderId);
    authCleanups.push(iCleanup);

    const { error } = await intruderClient.rpc("get_branch_owner_summary", {
      p_branch_id: branch.id,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("Not authorized");
  });

  // =====================================================================
  // 3. Owner-initiated withdrawal RPC is removed (migration 260)
  // =====================================================================
  it("3. transfer_branch_pool_to_owner_portfolio no longer exists", async () => {
    const { managerClient, branch } = await setupManagerScenario({ poolFunding: 1000 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (managerClient as any).rpc(
      "transfer_branch_pool_to_owner_portfolio",
      { p_branch_id: branch.id, p_amount: 1 }
    );

    // Postgres reports either "function ... does not exist" (42883)
    // or PostgREST wraps it as "Could not find the function".
    expect(error).not.toBeNull();
    const msg = (error!.message + " " + (error as { details?: string }).details).toLowerCase();
    expect(
      msg.includes("does not exist") ||
      msg.includes("could not find the function") ||
      msg.includes("not found")
    ).toBe(true);
  });
});
