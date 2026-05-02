/**
 * Tests for check_branch_velocity() — Phase 7 velocity alerts.
 * Verifies that branches with daily volume > 5× their 7-day average are flagged.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getServiceClient,
  createTestUser,
  createTestMarket,
  createTestBranch,
  createAuthenticatedClient,
  assignUserToBranch,
  cleanup,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("Branch Velocity Alerts", () => {
  let serviceClient: SupabaseClient;
  let managerId: string;
  let traderId: string;
  let traderClient: SupabaseClient;
  const branchIds: string[] = [];
  const marketIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    serviceClient = getServiceClient();

    // Create manager
    managerId = await createTestUser(serviceClient, { balance_usd: 0 });
    userIds.push(managerId);

    // Create trader with authenticated client (needed to call RPCs)
    const traderAuth = await createAuthenticatedClient(serviceClient, { balance_usd: 100000 });
    traderId = traderAuth.userId;
    traderClient = traderAuth.client;
    userIds.push(traderId);
  });

  afterAll(async () => {
    await cleanup(serviceClient, userIds, marketIds, branchIds);
  });

  it("should return empty when branch has no trades", async () => {
    const branch = await createTestBranch(serviceClient, managerId, {
      pool_balance: 10000,
    });
    branchIds.push(branch.id);

    const { data, error } = await serviceClient.rpc("check_branch_velocity");
    expect(error).toBeNull();

    // This branch should not appear (no trade history → avg = 0 → skipped)
    const found = (data as Array<{ branch_id: string }>).find(
      (r) => r.branch_id === branch.id
    );
    expect(found).toBeUndefined();
  });

  it("should not alert when today has zero volume", async () => {
    const marketId = await createTestMarket(serviceClient, managerId);
    marketIds.push(marketId);
    const branch = await createTestBranch(serviceClient, managerId, {
      pool_balance: 50000,
    });
    branchIds.push(branch.id);
    await assignUserToBranch(serviceClient, traderId, branch.id);

    // Create 7 trades, then move all to past days
    for (let d = 0; d < 7; d++) {
      const { error: tradeErr } = await traderClient.rpc("execute_branch_trade", {
        p_market_id: marketId,
        p_branch_id: branch.id,
        p_side: "yes",
        p_amount: 10,
      });
      expect(tradeErr).toBeNull();
    }

    // Move all trades to past days (use trades table, not branch_trades which is append-only)
    const { data: trades } = await serviceClient
      .from("trades")
      .select("id")
      .eq("branch_id", branch.id)
      .order("created_at", { ascending: true });

    for (let i = 0; i < trades!.length; i++) {
      const daysAgo = 7 - i;
      await serviceClient
        .from("trades")
        .update({ created_at: new Date(Date.now() - daysAgo * 86400000).toISOString() })
        .eq("id", trades![i].id);
    }

    // Today = $0 → ratio = 0 → no alert
    const { data: alerts, error } = await serviceClient.rpc("check_branch_velocity");
    expect(error).toBeNull();

    const found = (alerts as Array<{ branch_id: string }>).find(
      (r) => r.branch_id === branch.id
    );
    expect(found).toBeUndefined();
  });

  it("should detect velocity spike above 5× average", async () => {
    const marketId = await createTestMarket(serviceClient, managerId);
    marketIds.push(marketId);
    const branch = await createTestBranch(serviceClient, managerId, {
      pool_balance: 100000,
    });
    branchIds.push(branch.id);
    await assignUserToBranch(serviceClient, traderId, branch.id);

    // Create 7 historical trades → avg ~$10/day (after markup deduction)
    for (let d = 0; d < 7; d++) {
      const { error: tradeErr } = await traderClient.rpc("execute_branch_trade", {
        p_market_id: marketId,
        p_branch_id: branch.id,
        p_side: "yes",
        p_amount: 10,
      });
      expect(tradeErr).toBeNull();
    }

    // Move these to past 7 days (use trades table, not branch_trades which is append-only)
    const { data: pastTrades } = await serviceClient
      .from("trades")
      .select("id")
      .eq("branch_id", branch.id)
      .order("created_at", { ascending: true });

    for (let i = 0; i < 7; i++) {
      const daysAgo = 7 - i;
      await serviceClient
        .from("trades")
        .update({ created_at: new Date(Date.now() - daysAgo * 86400000).toISOString() })
        .eq("id", pastTrades![i].id);
    }

    // Create today's trades: 6× daily average → above 5x threshold
    for (let t = 0; t < 6; t++) {
      const { error: tradeErr } = await traderClient.rpc("execute_branch_trade", {
        p_market_id: marketId,
        p_branch_id: branch.id,
        p_side: "yes",
        p_amount: 10,
      });
      expect(tradeErr).toBeNull();
    }

    const { data: alerts, error } = await serviceClient.rpc("check_branch_velocity");
    expect(error).toBeNull();

    const found = (alerts as Array<{ branch_id: string; velocity_ratio: number; today_volume: number }>).find(
      (r) => r.branch_id === branch.id
    );
    expect(found).toBeDefined();
    expect(Number(found!.velocity_ratio)).toBeGreaterThan(5.0);
  });

  it("should skip new branches with no history", async () => {
    const marketId = await createTestMarket(serviceClient, managerId);
    marketIds.push(marketId);
    const branch = await createTestBranch(serviceClient, managerId, {
      pool_balance: 50000,
    });
    branchIds.push(branch.id);
    await assignUserToBranch(serviceClient, traderId, branch.id);

    // Only today's trades, no history → avg_vol = 0 → skipped
    for (let t = 0; t < 10; t++) {
      const { error: tradeErr } = await traderClient.rpc("execute_branch_trade", {
        p_market_id: marketId,
        p_branch_id: branch.id,
        p_side: "yes",
        p_amount: 10,
      });
      expect(tradeErr).toBeNull();
    }

    const { data: alerts, error } = await serviceClient.rpc("check_branch_velocity");
    expect(error).toBeNull();

    const found = (alerts as Array<{ branch_id: string }>).find(
      (r) => r.branch_id === branch.id
    );
    expect(found).toBeUndefined();
  });

  it("should write system_log entry on velocity spike", async () => {
    const marketId = await createTestMarket(serviceClient, managerId);
    marketIds.push(marketId);
    const branch = await createTestBranch(serviceClient, managerId, {
      pool_balance: 100000,
    });
    branchIds.push(branch.id);
    await assignUserToBranch(serviceClient, traderId, branch.id);

    // Create 7 historical trades
    for (let d = 0; d < 7; d++) {
      const { error: tradeErr } = await traderClient.rpc("execute_branch_trade", {
        p_market_id: marketId,
        p_branch_id: branch.id,
        p_side: "yes",
        p_amount: 10,
      });
      expect(tradeErr).toBeNull();
    }

    const { data: pastTrades } = await serviceClient
      .from("trades")
      .select("id")
      .eq("branch_id", branch.id)
      .order("created_at", { ascending: true });

    for (let i = 0; i < 7; i++) {
      const daysAgo = 7 - i;
      await serviceClient
        .from("trades")
        .update({ created_at: new Date(Date.now() - daysAgo * 86400000).toISOString() })
        .eq("id", pastTrades![i].id);
    }

    // Create today's spike: 8x average
    for (let t = 0; t < 8; t++) {
      const { error: tradeErr } = await traderClient.rpc("execute_branch_trade", {
        p_market_id: marketId,
        p_branch_id: branch.id,
        p_side: "yes",
        p_amount: 10,
      });
      expect(tradeErr).toBeNull();
    }

    // Clear any existing velocity logs for this branch
    await serviceClient
      .from("system_logs")
      .delete()
      .eq("source", "pg/branch-velocity")
      .filter("context->>branch_id", "eq", branch.id);

    // Run velocity check
    const { error } = await serviceClient.rpc("check_branch_velocity");
    expect(error).toBeNull();

    // Verify system_log entry was created
    const { data: logs } = await serviceClient
      .from("system_logs")
      .select("severity, source, message, context")
      .eq("source", "pg/branch-velocity")
      .filter("context->>branch_id", "eq", branch.id)
      .order("created_at", { ascending: false })
      .limit(1);

    expect(logs).not.toBeNull();
    expect(logs!.length).toBe(1);
    expect(logs![0].severity).toBe("warn");
    expect(logs![0].message).toContain("velocity spike");
    expect((logs![0].context as Record<string, unknown>).branch_id).toBe(branch.id);
  });
});
