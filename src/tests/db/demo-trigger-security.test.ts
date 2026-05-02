/**
 * demo-trigger-security.test.ts — regression tests for prevent_sensitive_user_updates
 *
 * CRITICAL: these tests prove that users cannot forge their own demo balance or
 * conversion-funnel columns. Every column added to the trigger must have a test
 * here. Tests run as NON-admin users — the trigger early-returns for admins
 * (migration 242 line 20), so admin tests would falsely pass.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getServiceClient,
  createAuthenticatedClient,
  cleanup,
  cleanupDemo,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("prevent_sensitive_user_updates — demo columns", () => {
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

  async function makeUser() {
    const auth = await createAuthenticatedClient(serviceClient, { balance_usd: 1 });
    userIds.push(auth.userId);
    authCleanups.push(auth.cleanup);
    return auth;
  }

  it("non-admin cannot UPDATE demo_balance_usd directly", async () => {
    const auth = await makeUser();
    const { error } = await auth.client
      .from("users")
      .update({ demo_balance_usd: 9999999 })
      .eq("id", auth.userId);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/protected|modify/i);
  });

  it("non-admin cannot UPDATE demo_first_enabled_at directly", async () => {
    const auth = await makeUser();
    const { error } = await auth.client
      .from("users")
      .update({ demo_first_enabled_at: new Date().toISOString() })
      .eq("id", auth.userId);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/protected|modify/i);
  });

  it("non-admin cannot UPDATE demo_first_trade_at directly", async () => {
    const auth = await makeUser();
    const { error } = await auth.client
      .from("users")
      .update({ demo_first_trade_at: new Date().toISOString() })
      .eq("id", auth.userId);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/protected|modify/i);
  });

  it("non-admin cannot UPDATE first_real_deposit_after_demo_at directly", async () => {
    const auth = await makeUser();
    const { error } = await auth.client
      .from("users")
      .update({ first_real_deposit_after_demo_at: new Date().toISOString() })
      .eq("id", auth.userId);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/protected|modify/i);
  });

  it("non-admin CAN UPDATE demo_mode (preference flag, not balance-granting)", async () => {
    const auth = await makeUser();
    const { error } = await auth.client
      .from("users")
      .update({ demo_mode: true })
      .eq("id", auth.userId);
    // demo_mode is user-writable; but note: setting it alone does NOT grant balance
    // because route access is gated on demo_first_enabled_at.
    expect(error).toBeNull();
  });

  it("service_role CAN UPDATE all demo_* columns", async () => {
    const auth = await makeUser();
    const { error } = await serviceClient
      .from("users")
      .update({
        demo_balance_usd: 5555,
        demo_first_enabled_at: new Date().toISOString(),
        demo_first_trade_at: new Date().toISOString(),
        first_real_deposit_after_demo_at: new Date().toISOString(),
      })
      .eq("id", auth.userId);
    expect(error).toBeNull();
  });
});
