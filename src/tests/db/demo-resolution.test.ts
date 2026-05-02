/**
 * demo-resolution.test.ts — tests for admin_resolve_demo_market RPC
 *
 * Cron-driven auto-resolution. Winners credited at $1/share (no 1% fee).
 * Reads scheduled_outcome from admin-only table. Idempotent on re-call.
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

describe("admin_resolve_demo_market RPC", () => {
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

  it("YES outcome credits YES holders at $1/share", async () => {
    const auth = await createAuthenticatedClient(serviceClient);
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);
    await enableDemoMode(auth.client);

    const marketId = await createTestDemoMarket(serviceClient, adminId, {
      scheduledOutcome: "yes",
    });
    demoMarketIds.push(marketId);

    await auth.client.rpc("demo_execute_trade", {
      p_market_id: marketId,
      p_side: "yes",
      p_amount: 200,
    });

    const { data: beforePos } = await serviceClient
      .from("demo_positions")
      .select("shares_held")
      .eq("user_id", auth.userId)
      .eq("market_id", marketId)
      .eq("side", "yes")
      .single();

    const { data: before } = await serviceClient
      .from("users")
      .select("demo_balance_usd")
      .eq("id", auth.userId)
      .single();

    const { error } = await serviceClient.rpc("admin_resolve_demo_market", {
      p_market_id: marketId,
    });
    expect(error).toBeNull();

    const { data: after } = await serviceClient
      .from("users")
      .select("demo_balance_usd")
      .eq("id", auth.userId)
      .single();

    // Winner credit = shares_held × $1.00
    const delta = Number(after!.demo_balance_usd) - Number(before!.demo_balance_usd);
    expect(Math.abs(delta - Number(beforePos!.shares_held))).toBeLessThan(0.01);
  });

  it("NO holders on a YES-outcome market get zero payout", async () => {
    const auth = await createAuthenticatedClient(serviceClient);
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);
    await enableDemoMode(auth.client);

    const marketId = await createTestDemoMarket(serviceClient, adminId, {
      scheduledOutcome: "yes",
    });
    demoMarketIds.push(marketId);

    await auth.client.rpc("demo_execute_trade", {
      p_market_id: marketId,
      p_side: "no",
      p_amount: 100,
    });

    const { data: before } = await serviceClient
      .from("users")
      .select("demo_balance_usd")
      .eq("id", auth.userId)
      .single();

    await serviceClient.rpc("admin_resolve_demo_market", { p_market_id: marketId });

    const { data: after } = await serviceClient
      .from("users")
      .select("demo_balance_usd")
      .eq("id", auth.userId)
      .single();

    expect(Number(after!.demo_balance_usd)).toBe(Number(before!.demo_balance_usd));

    // No demo_win transaction for this user
    const { data: wins } = await serviceClient
      .from("demo_transactions")
      .select("id")
      .eq("user_id", auth.userId)
      .eq("type", "demo_win");
    expect(wins!.length).toBe(0);
  });

  it("market status flips to resolved with resolved_at set", async () => {
    const marketId = await createTestDemoMarket(serviceClient, adminId);
    demoMarketIds.push(marketId);

    await serviceClient.rpc("admin_resolve_demo_market", { p_market_id: marketId });

    const { data: market } = await serviceClient
      .from("demo_markets")
      .select("status, resolved_at, outcome")
      .eq("id", marketId)
      .single();

    expect(market!.status).toBe("resolved");
    expect(market!.resolved_at).not.toBeNull();
    expect(market!.outcome).toBe("yes");
  });

  it("double-resolve is idempotent (winners not double-credited)", async () => {
    const auth = await createAuthenticatedClient(serviceClient);
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);
    await enableDemoMode(auth.client);

    const marketId = await createTestDemoMarket(serviceClient, adminId, {
      scheduledOutcome: "yes",
    });
    demoMarketIds.push(marketId);

    await auth.client.rpc("demo_execute_trade", {
      p_market_id: marketId,
      p_side: "yes",
      p_amount: 100,
    });

    await serviceClient.rpc("admin_resolve_demo_market", { p_market_id: marketId });

    const { data: mid } = await serviceClient
      .from("users")
      .select("demo_balance_usd")
      .eq("id", auth.userId)
      .single();

    const { data: second } = await serviceClient.rpc("admin_resolve_demo_market", {
      p_market_id: marketId,
    });
    expect(second.already_resolved).toBe(true);

    const { data: final } = await serviceClient
      .from("users")
      .select("demo_balance_usd")
      .eq("id", auth.userId)
      .single();

    expect(Number(final!.demo_balance_usd)).toBe(Number(mid!.demo_balance_usd));
  });

  it("zero-positions market resolves without crash", async () => {
    const marketId = await createTestDemoMarket(serviceClient, adminId);
    demoMarketIds.push(marketId);

    const { data, error } = await serviceClient.rpc("admin_resolve_demo_market", {
      p_market_id: marketId,
    });
    expect(error).toBeNull();
    expect(data.winners_paid).toBe(0);
  });

  it("live markets table unaffected by demo resolution", async () => {
    const marketId = await createTestDemoMarket(serviceClient, adminId);
    demoMarketIds.push(marketId);

    // Scope assertion to this demo market's id + a time window so concurrent
    // test runs writing to `transactions` for their own user_ids don't flake
    // this test. We only care that demo resolution doesn't insert into live
    // tables referencing this demo market.
    const beforeTime = new Date().toISOString();

    await serviceClient.rpc("admin_resolve_demo_market", { p_market_id: marketId });

    const { data: liveMarketRow } = await serviceClient
      .from("markets")
      .select("id")
      .eq("id", marketId);
    const { data: liveTxForMarket } = await serviceClient
      .from("transactions")
      .select("id")
      .gte("created_at", beforeTime)
      .eq("reference_id", marketId);

    expect(liveMarketRow?.length ?? 0).toBe(0);
    expect(liveTxForMarket?.length ?? 0).toBe(0);
  });
});
