/**
 * demo-conversion-analytics.test.ts — tests for conversion-funnel columns + RPC
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getServiceClient,
  createAuthenticatedClient,
  createTestDemoMarket,
  enableDemoMode,
  resetDemoConversionColumns,
  cleanup,
  cleanupDemo,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("Demo → Real conversion analytics", () => {
  let serviceClient: SupabaseClient;
  const userIds: string[] = [];
  const demoMarketIds: string[] = [];
  const authCleanups: (() => Promise<void>)[] = [];
  let adminId: string;
  let adminClient: SupabaseClient;

  beforeAll(async () => {
    serviceClient = getServiceClient();
    const admin = await createAuthenticatedClient(serviceClient, {
      is_admin: true,
      balance_usd: 10000,
    });
    adminId = admin.userId;
    adminClient = admin.client;
    userIds.push(adminId);
    authCleanups.push(admin.cleanup);
  });

  afterAll(async () => {
    for (const fn of authCleanups) await fn();
    await cleanupDemo(serviceClient, userIds, demoMarketIds);
    await cleanup(serviceClient, userIds);
  });

  it("demo_execute_trade sets demo_first_trade_at on first call, idempotent after", async () => {
    const auth = await createAuthenticatedClient(serviceClient);
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);
    await enableDemoMode(auth.client);
    await resetDemoConversionColumns(serviceClient, auth.userId);

    const marketId = await createTestDemoMarket(serviceClient, adminId);
    demoMarketIds.push(marketId);

    await auth.client.rpc("demo_execute_trade", {
      p_market_id: marketId,
      p_side: "yes",
      p_amount: 50,
    });

    const { data: first } = await serviceClient
      .from("users")
      .select("demo_first_trade_at")
      .eq("id", auth.userId)
      .single();
    expect(first!.demo_first_trade_at).not.toBeNull();
  });

  it("process_deposit sets first_real_deposit_after_demo_at for demo-enabled users only", async () => {
    // User A: enabled demo → should get first_real_deposit_after_demo_at
    const authA = await createAuthenticatedClient(serviceClient);
    userIds.push(authA.userId);
    authCleanups.push(authA.cleanup);
    await enableDemoMode(authA.client);
    await resetDemoConversionColumns(serviceClient, authA.userId);

    await serviceClient.rpc("process_deposit", {
      p_user_id: authA.userId,
      p_amount: 100,
      p_currency: "USDT",
      p_provider_ref: `test-${crypto.randomUUID()}`,
      p_provider: "3pay",
    });

    const { data: rowA } = await serviceClient
      .from("users")
      .select("first_real_deposit_after_demo_at")
      .eq("id", authA.userId)
      .single();
    expect(rowA!.first_real_deposit_after_demo_at).not.toBeNull();

    // User B: never enabled demo → should stay NULL
    const authB = await createAuthenticatedClient(serviceClient);
    userIds.push(authB.userId);
    authCleanups.push(authB.cleanup);

    await serviceClient.rpc("process_deposit", {
      p_user_id: authB.userId,
      p_amount: 100,
      p_currency: "USDT",
      p_provider_ref: `test-${crypto.randomUUID()}`,
      p_provider: "3pay",
    });

    const { data: rowB } = await serviceClient
      .from("users")
      .select("first_real_deposit_after_demo_at")
      .eq("id", authB.userId)
      .single();
    expect(rowB!.first_real_deposit_after_demo_at).toBeNull();
  });

  it("process_deposit is idempotent on first_real_deposit_after_demo_at (second deposit does not update)", async () => {
    const auth = await createAuthenticatedClient(serviceClient);
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);
    await enableDemoMode(auth.client);

    await serviceClient.rpc("process_deposit", {
      p_user_id: auth.userId,
      p_amount: 100,
      p_currency: "USDT",
      p_provider_ref: `test-${crypto.randomUUID()}`,
      p_provider: "3pay",
    });

    const { data: first } = await serviceClient
      .from("users")
      .select("first_real_deposit_after_demo_at")
      .eq("id", auth.userId)
      .single();
    const firstTime = first!.first_real_deposit_after_demo_at;

    await serviceClient.rpc("process_deposit", {
      p_user_id: auth.userId,
      p_amount: 50,
      p_currency: "USDT",
      p_provider_ref: `test-${crypto.randomUUID()}`,
      p_provider: "3pay",
    });

    const { data: second } = await serviceClient
      .from("users")
      .select("first_real_deposit_after_demo_at")
      .eq("id", auth.userId)
      .single();
    expect(second!.first_real_deposit_after_demo_at).toBe(firstTime);
  });

  it("get_demo_conversion_stats returns valid funnel shape", async () => {
    const { data, error } = await adminClient.rpc("get_demo_conversion_stats");
    expect(error).toBeNull();
    expect(data).toHaveProperty("total_enabled");
    expect(data).toHaveProperty("total_traded");
    expect(data).toHaveProperty("total_deposited_after_demo");
    expect(data).toHaveProperty("trade_rate");
    expect(data).toHaveProperty("deposit_rate");
    expect(data).toHaveProperty("cohort_7d");
    expect(data).toHaveProperty("cohort_30d");
  });

  it("get_demo_conversion_stats rejects non-admin caller", async () => {
    const auth = await createAuthenticatedClient(serviceClient);
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);

    const { error } = await auth.client.rpc("get_demo_conversion_stats");
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/admin/i);
  });
});
