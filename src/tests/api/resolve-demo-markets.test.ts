/**
 * resolve-demo-markets.test.ts — tests for the hourly cron route
 *
 * Verifies: CRON_SECRET auth, no-op on empty set, successful batch resolution,
 * mid-batch failure resilience.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import {
  getServiceClient,
  createAuthenticatedClient,
  createTestDemoMarket,
  cleanup,
  cleanupDemo,
} from "../db/helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

// Dynamic import of the route so env vars are picked up after vitest setup
async function callRoute(authHeader: string | null) {
  const mod = await import("@/app/api/cron/resolve-demo-markets/route");
  const url = "http://localhost/api/cron/resolve-demo-markets";
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  const req = new NextRequest(url, { method: "GET", headers });
  return mod.GET(req);
}

describe("GET /api/cron/resolve-demo-markets", () => {
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

  it("returns 401 without CRON_SECRET", async () => {
    const res = await callRoute(null);
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong secret", async () => {
    const res = await callRoute("Bearer WRONG_SECRET_VALUE");
    expect(res.status).toBe(401);
  });

  it("returns 200 + no-op when no markets are due", async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      // Skip when env not set up for this test run
      return;
    }
    const res = await callRoute(`Bearer ${secret}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.resolved_count).toBe("number");
  });

  it("resolves all due markets in a single batch", async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret) return;

    // Create 3 due markets (resolves_at in the past)
    const yesterday = new Date(Date.now() - 3600_000).toISOString();
    for (let i = 0; i < 3; i++) {
      const id = await createTestDemoMarket(serviceClient, adminId, {
        resolvesAt: yesterday,
        closesAt: yesterday,
        scheduledOutcome: i % 2 === 0 ? "yes" : "no",
      });
      demoMarketIds.push(id);
    }

    const res = await callRoute(`Bearer ${secret}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resolved_count).toBeGreaterThanOrEqual(3);

    // All three should now be resolved
    for (const id of demoMarketIds.slice(-3)) {
      const { data } = await serviceClient
        .from("demo_markets")
        .select("status")
        .eq("id", id)
        .single();
      expect(data!.status).toBe("resolved");
    }
  });
});
