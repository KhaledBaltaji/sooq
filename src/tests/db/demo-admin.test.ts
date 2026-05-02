/**
 * demo-admin.test.ts — tests for admin_create_demo_market + admin list RPC
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getServiceClient,
  createAuthenticatedClient,
  cleanup,
  cleanupDemo,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("Demo admin RPCs", () => {
  let serviceClient: SupabaseClient;
  const userIds: string[] = [];
  const demoMarketIds: string[] = [];
  const authCleanups: (() => Promise<void>)[] = [];
  let adminClient: SupabaseClient;
  let adminId: string;

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

  it("admin_create_demo_market atomically inserts market + schedule + amm + initial trade", async () => {
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const { data, error } = await adminClient.rpc("admin_create_demo_market", {
      p_question_en: "Atomic test market?",
      p_question_ar: "سوق اختبار ذري؟",
      p_category: "politics",
      p_liquidity_param: 5000,
      p_scheduled_outcome: "yes",
      p_resolves_at: tomorrow,
    });
    expect(error).toBeNull();
    expect(data.success).toBe(true);

    const marketId = data.market_id;
    demoMarketIds.push(marketId);

    const [{ data: market }, { data: schedule }, { data: amm }, { data: trades }] =
      await Promise.all([
        serviceClient.from("demo_markets").select("id").eq("id", marketId).single(),
        serviceClient
          .from("demo_market_scheduled_outcomes")
          .select("scheduled_outcome")
          .eq("market_id", marketId)
          .single(),
        serviceClient
          .from("demo_amm_state")
          .select("liquidity_param")
          .eq("market_id", marketId)
          .single(),
        serviceClient
          .from("demo_trades")
          .select("id")
          .eq("market_id", marketId),
      ]);
    expect(market).not.toBeNull();
    expect(schedule).not.toBeNull();
    expect(amm).not.toBeNull();
    // Synthetic initial-price trade
    expect((trades ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("rejects null scheduled_outcome", async () => {
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const { error } = await adminClient.rpc("admin_create_demo_market", {
      p_question_en: "Missing outcome?",
      p_question_ar: "بدون نتيجة؟",
      p_resolves_at: tomorrow,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/scheduled outcome/i);
  });

  it("rejects resolves_at in the past", async () => {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { error } = await adminClient.rpc("admin_create_demo_market", {
      p_question_en: "Past resolve?",
      p_question_ar: "انتهاء سابق؟",
      p_scheduled_outcome: "yes",
      p_resolves_at: yesterday,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/future|past/i);
  });

  it("rejects non-admin caller", async () => {
    const auth = await createAuthenticatedClient(serviceClient);
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);

    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const { error } = await auth.client.rpc("admin_create_demo_market", {
      p_question_en: "Unauthorized?",
      p_question_ar: "غير مصرح؟",
      p_scheduled_outcome: "yes",
      p_resolves_at: tomorrow,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/admin/i);
  });

  it("admin_list_demo_markets_with_outcomes returns joined rows", async () => {
    const { data, error } = await adminClient.rpc(
      "admin_list_demo_markets_with_outcomes"
    );
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    // Each row has both scheduled_outcome and market fields
    if (data!.length > 0) {
      const sample = data![0];
      expect(sample).toHaveProperty("market_id");
      expect(sample).toHaveProperty("scheduled_outcome");
      expect(sample).toHaveProperty("resolves_at");
    }
  });
});
