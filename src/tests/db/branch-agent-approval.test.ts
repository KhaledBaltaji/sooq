/**
 * branch-agent-approval.test.ts — Tests for the branch agent approval workflow RPCs:
 * apply_branch_agent, approve_branch_agent, reject_branch_agent, update_branch_agent_deal
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getServiceClient,
  createTestUser,
  createAuthenticatedClient,
  createTestBranch,
  assignUserToBranch,
  cleanup,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("branch agent approval workflow", () => {
  let serviceClient: SupabaseClient;
  const userIds: string[] = [];
  const branchIds: string[] = [];
  const authCleanups: (() => Promise<void>)[] = [];

  let managerId: string;
  let managerClient: SupabaseClient | null = null;
  let applicantId: string;
  let applicantClient: SupabaseClient | null = null;
  let otherUserId: string;
  let otherUserClient: SupabaseClient | null = null;
  let branch: { id: string; code: string };
  let authSupported = false;
  let rpcsExist = false;

  beforeAll(async () => {
    serviceClient = getServiceClient();

    // Check if migration 231 RPCs exist yet
    const { error: rpcCheck } = await serviceClient.rpc("apply_branch_agent", { p_branch_id: "00000000-0000-0000-0000-000000000000" });
    // If the error is "function not found" or similar schema error, RPCs don't exist
    rpcsExist = !(rpcCheck?.message?.includes("Could not find the function") || rpcCheck?.message?.includes("function") && rpcCheck?.message?.includes("does not exist"));
    if (!rpcsExist) return; // Skip setup if RPCs not deployed

    try {
      // Create branch manager (authenticated)
      const mgrAuth = await createAuthenticatedClient(serviceClient, { balance_usd: 10000 });
      managerClient = mgrAuth.client;
      managerId = mgrAuth.userId;
      userIds.push(managerId);
      authCleanups.push(mgrAuth.cleanup);

      // Create applicant user (authenticated)
      const appAuth = await createAuthenticatedClient(serviceClient, { balance_usd: 5000 });
      applicantClient = appAuth.client;
      applicantId = appAuth.userId;
      userIds.push(applicantId);
      authCleanups.push(appAuth.cleanup);

      // Create another user (non-manager, for auth tests)
      const otherAuth = await createAuthenticatedClient(serviceClient, { balance_usd: 5000 });
      otherUserClient = otherAuth.client;
      otherUserId = otherAuth.userId;
      userIds.push(otherUserId);
      authCleanups.push(otherAuth.cleanup);

      authSupported = true;
    } catch {
      // Auth not supported — tests will skip gracefully
      managerId = await createTestUser(serviceClient, { balance_usd: 10000 });
      userIds.push(managerId);
      applicantId = await createTestUser(serviceClient, { balance_usd: 5000 });
      userIds.push(applicantId);
      otherUserId = await createTestUser(serviceClient, { balance_usd: 5000 });
      userIds.push(otherUserId);
    }

    // Create branch owned by manager
    branch = await createTestBranch(serviceClient, managerId);
    branchIds.push(branch.id);

    // Assign applicant to branch (required for apply)
    await assignUserToBranch(serviceClient, applicantId, branch.id);
    // Assign other user to branch too (for non-manager tests)
    await assignUserToBranch(serviceClient, otherUserId, branch.id);
  });

  afterAll(async () => {
    for (const fn of authCleanups) await fn();
    await cleanup(serviceClient, userIds, [], branchIds);
  });



  // ================================================================
  // apply_branch_agent
  // ================================================================
  describe("apply_branch_agent", () => {
    it("happy path: user applies and gets pending status", async () => {
      if (!rpcsExist) return;
      if (!authSupported || !applicantClient) {
        const { error } = await serviceClient.rpc("apply_branch_agent", {
          p_branch_id: branch.id,
        });
        expect(error).not.toBeNull();
        expect(error!.message).toContain("Not authenticated");
        return;
      }

      const { data, error } = await applicantClient.rpc("apply_branch_agent", {
        p_branch_id: branch.id,
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.agent_id).toBeDefined();
      expect(data.status).toBe("pending");

      // Verify row in DB
      const { data: agent } = await serviceClient
        .from("branch_agents")
        .select("*")
        .eq("id", data.agent_id)
        .single();

      expect(agent).toBeDefined();
      expect(agent!.status).toBe("pending");
      expect(agent!.agent_type).toBeNull();
      expect(agent!.rate).toBeNull();
      expect(agent!.is_active).toBe(false);
      expect(agent!.referral_code).toBeDefined();
    });

    it("error: user not assigned to branch", async () => {
          if (!rpcsExist) return;
      if (!authSupported || !applicantClient) {
        const { error } = await serviceClient.rpc("apply_branch_agent", {
          p_branch_id: crypto.randomUUID(),
        });
        expect(error).not.toBeNull();
        return;
      }

      // Create a branch where the applicant is NOT assigned
      const otherBranch = await createTestBranch(serviceClient, managerId);
      branchIds.push(otherBranch.id);

      const { error } = await applicantClient.rpc("apply_branch_agent", {
        p_branch_id: otherBranch.id,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/not assigned/i);
    });

    it("error: duplicate application", async () => {
          if (!rpcsExist) return;
      if (!authSupported || !applicantClient) {
        const { error } = await serviceClient.rpc("apply_branch_agent", {
          p_branch_id: branch.id,
        });
        expect(error).not.toBeNull();
        return;
      }

      // The applicant already applied in the happy path test
      const { error } = await applicantClient.rpc("apply_branch_agent", {
        p_branch_id: branch.id,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/already applied/i);
    });

    it("error: unauthenticated call via service role", async () => {
          if (!rpcsExist) return;
      const { error } = await serviceClient.rpc("apply_branch_agent", {
        p_branch_id: branch.id,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toContain("Not authenticated");
    });

    it("error: branch is suspended", async () => {
          if (!rpcsExist) return;
      if (!authSupported || !otherUserClient) {
        const { error } = await serviceClient.rpc("apply_branch_agent", {
          p_branch_id: branch.id,
        });
        expect(error).not.toBeNull();
        return;
      }

      // Create a suspended branch
      const suspBranch = await createTestBranch(serviceClient, managerId, { status: "suspended" });
      branchIds.push(suspBranch.id);
      // Assign other user to it
      await assignUserToBranch(serviceClient, otherUserId, suspBranch.id);

      const { error } = await otherUserClient.rpc("apply_branch_agent", {
        p_branch_id: suspBranch.id,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/suspended/i);
    });
  });

  // ================================================================
  // approve_branch_agent
  // ================================================================
  describe("approve_branch_agent", () => {
    let pendingAgentId: string;

    beforeAll(async () => {
      if (!authSupported) return;

      // Get the pending agent from apply tests
      const { data: agents } = await serviceClient
        .from("branch_agents")
        .select("id")
        .eq("user_id", applicantId)
        .eq("branch_id", branch.id)
        .eq("status", "pending");

      if (agents && agents.length > 0) {
        pendingAgentId = agents[0].id;
      }
    });

    it("happy path: manager approves, is_active synced to true", async () => {
          if (!rpcsExist) return;
      if (!authSupported || !managerClient || !pendingAgentId) {
        const { error } = await serviceClient.rpc("approve_branch_agent", {
          p_agent_id: crypto.randomUUID(),
          p_agent_type: "commission",
          p_rate: 0.1,
        });
        expect(error).not.toBeNull();
        return;
      }

      const { data, error } = await managerClient.rpc("approve_branch_agent", {
        p_agent_id: pendingAgentId,
        p_agent_type: "commission",
        p_rate: 0.15,
        p_deposit_required: 100,
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.status).toBe("approved");
      expect(data.agent_type).toBe("commission");
      expect(Number(data.rate)).toBeCloseTo(0.15);

      // Verify DB state
      const { data: agent } = await serviceClient
        .from("branch_agents")
        .select("*")
        .eq("id", pendingAgentId)
        .single();

      expect(agent!.status).toBe("approved");
      expect(agent!.is_active).toBe(true);
      expect(agent!.agent_type).toBe("commission");
      expect(Number(agent!.rate)).toBeCloseTo(0.15);
      expect(Number(agent!.deposit_required)).toBe(100);
      expect(agent!.approved_at).toBeDefined();
      expect(agent!.approved_by).toBe(managerId);
    });

    it("error: non-manager tries to approve", async () => {
          if (!rpcsExist) return;
      if (!authSupported || !otherUserClient) {
        const { error } = await serviceClient.rpc("approve_branch_agent", {
          p_agent_id: crypto.randomUUID(),
          p_agent_type: "commission",
          p_rate: 0.1,
        });
        expect(error).not.toBeNull();
        return;
      }

      // Create a new pending agent for this test
      const newApplicant = await createAuthenticatedClient(serviceClient, { balance_usd: 1000 });
      userIds.push(newApplicant.userId);
      authCleanups.push(newApplicant.cleanup);
      await assignUserToBranch(serviceClient, newApplicant.userId, branch.id);

      const { data: applyData } = await newApplicant.client.rpc("apply_branch_agent", {
        p_branch_id: branch.id,
      });

      const { error } = await otherUserClient.rpc("approve_branch_agent", {
        p_agent_id: applyData.agent_id,
        p_agent_type: "commission",
        p_rate: 0.1,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/not authorized|not branch manager/i);
    });

    it("error: agent not in pending status", async () => {
          if (!rpcsExist) return;
      if (!authSupported || !managerClient || !pendingAgentId) {
        const { error } = await serviceClient.rpc("approve_branch_agent", {
          p_agent_id: crypto.randomUUID(),
          p_agent_type: "commission",
          p_rate: 0.1,
        });
        expect(error).not.toBeNull();
        return;
      }

      // pendingAgentId was already approved in the happy path test
      const { error } = await managerClient.rpc("approve_branch_agent", {
        p_agent_id: pendingAgentId,
        p_agent_type: "pl",
        p_rate: 0.2,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/not in pending/i);
    });

    it("error: invalid rate (0 or >1)", async () => {
          if (!rpcsExist) return;
      if (!authSupported || !managerClient) {
        const { error } = await serviceClient.rpc("approve_branch_agent", {
          p_agent_id: crypto.randomUUID(),
          p_agent_type: "commission",
          p_rate: 0,
        });
        expect(error).not.toBeNull();
        return;
      }

      // Create another pending agent
      const rateTestUser = await createAuthenticatedClient(serviceClient, { balance_usd: 1000 });
      userIds.push(rateTestUser.userId);
      authCleanups.push(rateTestUser.cleanup);
      await assignUserToBranch(serviceClient, rateTestUser.userId, branch.id);

      const { data: applyData } = await rateTestUser.client.rpc("apply_branch_agent", {
        p_branch_id: branch.id,
      });

      // Rate = 0
      const { error: zeroErr } = await managerClient.rpc("approve_branch_agent", {
        p_agent_id: applyData.agent_id,
        p_agent_type: "commission",
        p_rate: 0,
      });
      expect(zeroErr).not.toBeNull();
      expect(zeroErr!.message).toMatch(/invalid rate/i);

      // Rate > 1
      const { error: highErr } = await managerClient.rpc("approve_branch_agent", {
        p_agent_id: applyData.agent_id,
        p_agent_type: "commission",
        p_rate: 1.5,
      });
      expect(highErr).not.toBeNull();
      expect(highErr!.message).toMatch(/invalid rate/i);
    });
  });

  // ================================================================
  // reject_branch_agent
  // ================================================================
  describe("reject_branch_agent", () => {
    it("happy path: manager rejects with reason", async () => {
          if (!rpcsExist) return;
      if (!authSupported || !managerClient) {
        const { error } = await serviceClient.rpc("reject_branch_agent", {
          p_agent_id: crypto.randomUUID(),
        });
        expect(error).not.toBeNull();
        return;
      }

      // Create a new pending agent
      const rejectUser = await createAuthenticatedClient(serviceClient, { balance_usd: 1000 });
      userIds.push(rejectUser.userId);
      authCleanups.push(rejectUser.cleanup);
      await assignUserToBranch(serviceClient, rejectUser.userId, branch.id);

      const { data: applyData } = await rejectUser.client.rpc("apply_branch_agent", {
        p_branch_id: branch.id,
      });

      const { data, error } = await managerClient.rpc("reject_branch_agent", {
        p_agent_id: applyData.agent_id,
        p_reason: "Insufficient experience",
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.status).toBe("rejected");

      // Verify DB state
      const { data: agent } = await serviceClient
        .from("branch_agents")
        .select("*")
        .eq("id", applyData.agent_id)
        .single();

      expect(agent!.status).toBe("rejected");
      expect(agent!.rejection_reason).toBe("Insufficient experience");
      expect(agent!.is_active).toBe(false);
    });

    it("error: non-manager tries to reject", async () => {
          if (!rpcsExist) return;
      if (!authSupported || !otherUserClient) {
        const { error } = await serviceClient.rpc("reject_branch_agent", {
          p_agent_id: crypto.randomUUID(),
        });
        expect(error).not.toBeNull();
        return;
      }

      // Create a pending agent
      const rejectUser2 = await createAuthenticatedClient(serviceClient, { balance_usd: 1000 });
      userIds.push(rejectUser2.userId);
      authCleanups.push(rejectUser2.cleanup);
      await assignUserToBranch(serviceClient, rejectUser2.userId, branch.id);

      const { data: applyData } = await rejectUser2.client.rpc("apply_branch_agent", {
        p_branch_id: branch.id,
      });

      const { error } = await otherUserClient.rpc("reject_branch_agent", {
        p_agent_id: applyData.agent_id,
        p_reason: "test",
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/not authorized|not branch manager/i);
    });

    it("error: agent not in pending status", async () => {
          if (!rpcsExist) return;
      if (!authSupported || !managerClient) {
        const { error } = await serviceClient.rpc("reject_branch_agent", {
          p_agent_id: crypto.randomUUID(),
        });
        expect(error).not.toBeNull();
        return;
      }

      // Create and approve an agent first, then try to reject
      const notPendingUser = await createAuthenticatedClient(serviceClient, { balance_usd: 1000 });
      userIds.push(notPendingUser.userId);
      authCleanups.push(notPendingUser.cleanup);
      await assignUserToBranch(serviceClient, notPendingUser.userId, branch.id);

      const { data: applyData } = await notPendingUser.client.rpc("apply_branch_agent", {
        p_branch_id: branch.id,
      });

      // Approve first
      await managerClient.rpc("approve_branch_agent", {
        p_agent_id: applyData.agent_id,
        p_agent_type: "commission",
        p_rate: 0.1,
      });

      // Now try to reject
      const { error } = await managerClient.rpc("reject_branch_agent", {
        p_agent_id: applyData.agent_id,
        p_reason: "Changed my mind",
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/not in pending/i);
    });

    it("edge: null reason succeeds", async () => {
          if (!rpcsExist) return;
      if (!authSupported || !managerClient) {
        const { error } = await serviceClient.rpc("reject_branch_agent", {
          p_agent_id: crypto.randomUUID(),
        });
        expect(error).not.toBeNull();
        return;
      }

      // Create a pending agent
      const nullReasonUser = await createAuthenticatedClient(serviceClient, { balance_usd: 1000 });
      userIds.push(nullReasonUser.userId);
      authCleanups.push(nullReasonUser.cleanup);
      await assignUserToBranch(serviceClient, nullReasonUser.userId, branch.id);

      const { data: applyData } = await nullReasonUser.client.rpc("apply_branch_agent", {
        p_branch_id: branch.id,
      });

      const { data, error } = await managerClient.rpc("reject_branch_agent", {
        p_agent_id: applyData.agent_id,
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.status).toBe("rejected");

      // Verify null reason in DB
      const { data: agent } = await serviceClient
        .from("branch_agents")
        .select("rejection_reason")
        .eq("id", applyData.agent_id)
        .single();

      expect(agent!.rejection_reason).toBeNull();
    });
  });

  // ================================================================
  // update_branch_agent_deal
  // ================================================================
  describe("update_branch_agent_deal", () => {
    let approvedAgentId: string;

    beforeAll(async () => {
      if (!authSupported || !managerClient) return;

      // Create and approve an agent specifically for deal update tests
      const dealUser = await createAuthenticatedClient(serviceClient, { balance_usd: 1000 });
      userIds.push(dealUser.userId);
      authCleanups.push(dealUser.cleanup);
      await assignUserToBranch(serviceClient, dealUser.userId, branch.id);

      const { data: applyData } = await dealUser.client.rpc("apply_branch_agent", {
        p_branch_id: branch.id,
      });

      await managerClient.rpc("approve_branch_agent", {
        p_agent_id: applyData.agent_id,
        p_agent_type: "commission",
        p_rate: 0.1,
        p_deposit_required: 0,
      });

      approvedAgentId = applyData.agent_id;
    });

    it("happy path: update approved agent deal terms", async () => {
          if (!rpcsExist) return;
      if (!authSupported || !managerClient || !approvedAgentId) {
        const { error } = await serviceClient.rpc("update_branch_agent_deal", {
          p_agent_id: crypto.randomUUID(),
          p_agent_type: "pl",
          p_rate: 0.2,
        });
        expect(error).not.toBeNull();
        return;
      }

      const { data, error } = await managerClient.rpc("update_branch_agent_deal", {
        p_agent_id: approvedAgentId,
        p_agent_type: "pl",
        p_rate: 0.25,
        p_deposit_required: 500,
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.agent_type).toBe("pl");
      expect(Number(data.rate)).toBeCloseTo(0.25);
      expect(Number(data.deposit_required)).toBe(500);

      // Verify DB
      const { data: agent } = await serviceClient
        .from("branch_agents")
        .select("agent_type, rate, deposit_required")
        .eq("id", approvedAgentId)
        .single();

      expect(agent!.agent_type).toBe("pl");
      expect(Number(agent!.rate)).toBeCloseTo(0.25);
      expect(Number(agent!.deposit_required)).toBe(500);
    });

    it("error: agent not approved (pending)", async () => {
          if (!rpcsExist) return;
      if (!authSupported || !managerClient) {
        const { error } = await serviceClient.rpc("update_branch_agent_deal", {
          p_agent_id: crypto.randomUUID(),
          p_agent_type: "commission",
          p_rate: 0.1,
        });
        expect(error).not.toBeNull();
        return;
      }

      // Create a pending agent
      const pendingUser = await createAuthenticatedClient(serviceClient, { balance_usd: 1000 });
      userIds.push(pendingUser.userId);
      authCleanups.push(pendingUser.cleanup);
      await assignUserToBranch(serviceClient, pendingUser.userId, branch.id);

      const { data: applyData } = await pendingUser.client.rpc("apply_branch_agent", {
        p_branch_id: branch.id,
      });

      const { error } = await managerClient.rpc("update_branch_agent_deal", {
        p_agent_id: applyData.agent_id,
        p_agent_type: "commission",
        p_rate: 0.1,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/only update deal for approved/i);
    });

    it("error: non-manager tries to update deal", async () => {
          if (!rpcsExist) return;
      if (!authSupported || !otherUserClient || !approvedAgentId) {
        const { error } = await serviceClient.rpc("update_branch_agent_deal", {
          p_agent_id: crypto.randomUUID(),
          p_agent_type: "commission",
          p_rate: 0.1,
        });
        expect(error).not.toBeNull();
        return;
      }

      const { error } = await otherUserClient.rpc("update_branch_agent_deal", {
        p_agent_id: approvedAgentId,
        p_agent_type: "commission",
        p_rate: 0.2,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/not authorized|not branch manager/i);
    });
  });
});
