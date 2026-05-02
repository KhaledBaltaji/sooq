/**
 * demo-toggle.test.ts — tests for toggle_demo_mode RPC
 *
 * Atomic first-enable grants $10K; subsequent toggles just flip the preference
 * flag. Live balance_usd never touched. Concurrent first-enable only grants $10K
 * once (WHERE demo_first_enabled_at IS NULL guard).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getServiceClient,
  createAuthenticatedClient,
  cleanup,
  cleanupDemo,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("toggle_demo_mode RPC", () => {
  let serviceClient: SupabaseClient;
  const userIds: string[] = [];
  const authCleanups: (() => Promise<void>)[] = [];

  beforeAll(() => {
    serviceClient = getServiceClient();
  });

  afterAll(async () => {
    for (const fn of authCleanups) await fn();
    await cleanupDemo(serviceClient, userIds);
    await cleanup(serviceClient, userIds);
  });

  it("first enable grants $10K and sets demo_first_enabled_at", async () => {
    const auth = await createAuthenticatedClient(serviceClient, { balance_usd: 500 });
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);

    const { data, error } = await auth.client.rpc("toggle_demo_mode", { p_enabled: true });
    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.granted_initial_balance).toBe(true);
    expect(Number(data.demo_balance_usd)).toBe(10000);

    // Live balance should be untouched
    const { data: userRow } = await serviceClient
      .from("users")
      .select("balance_usd, demo_balance_usd, demo_first_enabled_at, demo_mode")
      .eq("id", auth.userId)
      .single();
    expect(Number(userRow!.balance_usd)).toBe(500);
    expect(Number(userRow!.demo_balance_usd)).toBe(10000);
    expect(userRow!.demo_first_enabled_at).not.toBeNull();
    expect(userRow!.demo_mode).toBe(true);
  });

  it("second toggle (disable → enable) preserves balance and does not re-grant $10K", async () => {
    const auth = await createAuthenticatedClient(serviceClient, { balance_usd: 0 });
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);

    await auth.client.rpc("toggle_demo_mode", { p_enabled: true });
    // Spend some balance via direct update (simulate trading)
    await serviceClient
      .from("users")
      .update({ demo_balance_usd: 8500 })
      .eq("id", auth.userId);

    // Toggle off
    const { data: offData } = await auth.client.rpc("toggle_demo_mode", {
      p_enabled: false,
    });
    expect(offData.granted_initial_balance).toBe(false);

    // Toggle back on
    const { data: onData } = await auth.client.rpc("toggle_demo_mode", {
      p_enabled: true,
    });
    expect(onData.granted_initial_balance).toBe(false);
    expect(Number(onData.demo_balance_usd)).toBe(8500);
  });

  it("live balance_usd is never touched by any demo toggle", async () => {
    const auth = await createAuthenticatedClient(serviceClient, { balance_usd: 1234 });
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);

    await auth.client.rpc("toggle_demo_mode", { p_enabled: true });
    await auth.client.rpc("toggle_demo_mode", { p_enabled: false });
    await auth.client.rpc("toggle_demo_mode", { p_enabled: true });

    const { data } = await serviceClient
      .from("users")
      .select("balance_usd")
      .eq("id", auth.userId)
      .single();
    expect(Number(data!.balance_usd)).toBe(1234);
  });

  it("concurrent first-enable calls only grant $10K once (atomic WHERE guard)", async () => {
    const auth = await createAuthenticatedClient(serviceClient, { balance_usd: 0 });
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);

    const results = await Promise.all([
      auth.client.rpc("toggle_demo_mode", { p_enabled: true }),
      auth.client.rpc("toggle_demo_mode", { p_enabled: true }),
      auth.client.rpc("toggle_demo_mode", { p_enabled: true }),
    ]);

    const grantCount = results.filter(
      (r) => r.data && r.data.granted_initial_balance === true
    ).length;
    expect(grantCount).toBe(1);

    // Demo balance should still be exactly 10,000 (no double-grant, no ledger duplicate)
    const { data } = await serviceClient
      .from("users")
      .select("demo_balance_usd")
      .eq("id", auth.userId)
      .single();
    expect(Number(data!.demo_balance_usd)).toBe(10000);

    // Only ONE demo_seed row should exist
    const { data: seedRows } = await serviceClient
      .from("demo_transactions")
      .select("id")
      .eq("user_id", auth.userId)
      .eq("type", "demo_seed");
    expect(seedRows!.length).toBe(1);
  });
});
