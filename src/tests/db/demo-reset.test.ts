/**
 * demo-reset.test.ts — tests for demo_reset_balance RPC
 *
 * Resets to $10K regardless of current balance. Positions preserved (known
 * free-option exploit, documented in plan). One demo_reset transaction inserted.
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

describe("demo_reset_balance RPC", () => {
  let serviceClient: SupabaseClient;
  const userIds: string[] = [];
  const demoMarketIds: string[] = [];
  const authCleanups: (() => Promise<void>)[] = [];
  let adminId: string;

  beforeAll(async () => {
    serviceClient = getServiceClient();
    const admin = await createAuthenticatedClient(serviceClient, {
      is_admin: true,
      balance_usd: 10000,
    });
    adminId = admin.userId;
    userIds.push(adminId);
    authCleanups.push(admin.cleanup);
  });

  afterAll(async () => {
    for (const fn of authCleanups) await fn();
    await cleanupDemo(serviceClient, userIds, demoMarketIds);
    await cleanup(serviceClient, userIds);
  });

  it("sets balance to 10000 regardless of current value", async () => {
    const auth = await createAuthenticatedClient(serviceClient);
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);
    await enableDemoMode(auth.client);

    // Drain balance
    await serviceClient
      .from("users")
      .update({ demo_balance_usd: 100 })
      .eq("id", auth.userId);

    const { data, error } = await auth.client.rpc("demo_reset_balance");
    expect(error).toBeNull();
    expect(Number(data.demo_balance_usd)).toBe(10000);
  });

  it("preserves open positions", async () => {
    const auth = await createAuthenticatedClient(serviceClient);
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);
    await enableDemoMode(auth.client);

    const marketId = await createTestDemoMarket(serviceClient, adminId);
    demoMarketIds.push(marketId);

    await auth.client.rpc("demo_execute_trade", {
      p_market_id: marketId,
      p_side: "yes",
      p_amount: 100,
    });

    const { data: before } = await serviceClient
      .from("demo_positions")
      .select("id, shares_held")
      .eq("user_id", auth.userId)
      .eq("market_id", marketId);

    await auth.client.rpc("demo_reset_balance");

    const { data: after } = await serviceClient
      .from("demo_positions")
      .select("id, shares_held")
      .eq("user_id", auth.userId)
      .eq("market_id", marketId);

    expect(after!.length).toBe(before!.length);
    expect(Number(after![0].shares_held)).toBe(Number(before![0].shares_held));
  });

  it("inserts one demo_transactions row with type demo_reset", async () => {
    const auth = await createAuthenticatedClient(serviceClient);
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);
    await enableDemoMode(auth.client);

    await auth.client.rpc("demo_reset_balance");

    const { data } = await serviceClient
      .from("demo_transactions")
      .select("type, amount")
      .eq("user_id", auth.userId)
      .eq("type", "demo_reset");
    expect(data!.length).toBe(1);
  });

  it("rejects when demo not initialized", async () => {
    const auth = await createAuthenticatedClient(serviceClient, { balance_usd: 100 });
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);
    // Do NOT enable demo

    const { error } = await auth.client.rpc("demo_reset_balance");
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/not initialized|demo mode/i);
  });
});
