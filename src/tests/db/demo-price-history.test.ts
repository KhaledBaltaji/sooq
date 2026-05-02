/**
 * demo-price-history.test.ts — tests for demo_get_price_history RPC
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getServiceClient,
  createAuthenticatedClient,
  createTestDemoMarket,
  enableDemoMode,
  cleanup,
  cleanupDemo,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("demo_get_price_history RPC", () => {
  let serviceClient: SupabaseClient;
  const userIds: string[] = [];
  const demoMarketIds: string[] = [];
  const authCleanups: (() => Promise<void>)[] = [];
  let adminId: string;
  let userClient: SupabaseClient;

  beforeAll(async () => {
    serviceClient = getServiceClient();
    const admin = await createAuthenticatedClient(serviceClient, {
      is_admin: true,
      balance_usd: 10000,
    });
    adminId = admin.userId;
    userIds.push(adminId);
    authCleanups.push(admin.cleanup);

    const user = await createAuthenticatedClient(serviceClient);
    userClient = user.client;
    userIds.push(user.userId);
    authCleanups.push(user.cleanup);
    await enableDemoMode(userClient);
  });

  afterAll(async () => {
    for (const fn of authCleanups) await fn();
    await cleanupDemo(serviceClient, userIds, demoMarketIds);
    await cleanup(serviceClient, userIds);
  });

  it("returns time-bucket rows for 1D period after trades", async () => {
    const marketId = await createTestDemoMarket(serviceClient, adminId);
    demoMarketIds.push(marketId);

    await userClient.rpc("demo_execute_trade", {
      p_market_id: marketId,
      p_side: "yes",
      p_amount: 100,
    });

    const { data, error } = await userClient.rpc("demo_get_price_history", {
      p_market_id: marketId,
      p_period: "1D",
    });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) {
      expect(row).toHaveProperty("bucket_time");
      expect(row).toHaveProperty("yes_price");
      expect(row).toHaveProperty("no_price");
    }
  });

  it("empty market returns rows (pre-trade buckets default to 0.5)", async () => {
    const marketId = await createTestDemoMarket(serviceClient, adminId);
    demoMarketIds.push(marketId);

    const { data, error } = await userClient.rpc("demo_get_price_history", {
      p_market_id: marketId,
      p_period: "1D",
    });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    // Every row in an untrade-market should be 0.5 (initial price)
    for (const row of data!) {
      expect(Number(row.yes_price)).toBeCloseTo(0.5, 4);
      expect(Number(row.no_price)).toBeCloseTo(0.5, 4);
    }
  });

  it("ALL period starts from p_created_at", async () => {
    const marketId = await createTestDemoMarket(serviceClient, adminId);
    demoMarketIds.push(marketId);

    const { data: market } = await serviceClient
      .from("demo_markets")
      .select("created_at")
      .eq("id", marketId)
      .single();

    const { data, error } = await userClient.rpc("demo_get_price_history", {
      p_market_id: marketId,
      p_period: "ALL",
      p_created_at: market!.created_at,
    });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(data!.length).toBeGreaterThan(0);
  });
});
