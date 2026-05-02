/**
 * admin-credit.test.ts — Admin credit/debit RPC tests
 *
 * Tests: admin_set_pin, admin_adjust_balance (credit, debit),
 * wrong PIN, lockout, insufficient balance, frozen user, audit trail.
 *
 * Uses createAuthenticatedClient to get real Supabase sessions with auth.uid().
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SupabaseClient } from "@supabase/supabase-js";
import {
  getServiceClient,
  createTestUser,
  createAuthenticatedClient,
  cleanup,
} from "./helpers";

let serviceClient: SupabaseClient;
let adminClient: SupabaseClient;
let adminUserId: string;
let targetUserId: string;
const testUserIds: string[] = [];
const authCleanups: (() => Promise<void>)[] = [];

const TEST_PIN = "1234";

beforeAll(async () => {
  serviceClient = getServiceClient();

  // Create an admin user with authenticated client
  const adminAuth = await createAuthenticatedClient(serviceClient, {
    is_admin: true,
    balance_usd: 0,
  });
  adminClient = adminAuth.client;
  adminUserId = adminAuth.userId;
  testUserIds.push(adminUserId);
  authCleanups.push(adminAuth.cleanup);

  // Create a target user for credit/debit
  targetUserId = await createTestUser(serviceClient, { balance_usd: 100 });
  testUserIds.push(targetUserId);
});

afterAll(async () => {
  // Clean up admin_config rows
  await serviceClient.from("admin_config").delete().eq("admin_user_id", adminUserId);
  for (const fn of authCleanups) await fn();
  await cleanup(serviceClient, testUserIds, []);
});

describe("Admin Credit/Debit", () => {
  // -----------------------------------------------------------------------
  // 1. Admin can set PIN
  // -----------------------------------------------------------------------
  it("should allow admin to set PIN", async () => {
    const { data, error } = await adminClient.rpc("admin_set_pin", {
      p_pin: TEST_PIN,
    });
    expect(error).toBeNull();
    expect(data).toEqual({ success: true });

    // Verify admin_has_pin returns true
    const { data: hasPin } = await adminClient.rpc("admin_has_pin");
    expect(hasPin).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 2. Admin can credit user balance
  // -----------------------------------------------------------------------
  it("should credit user balance with correct PIN", async () => {
    const { data, error } = await adminClient.rpc("admin_adjust_balance", {
      p_user_id: targetUserId,
      p_amount: 50,
      p_description: "Test credit",
      p_pin: TEST_PIN,
    });
    expect(error).toBeNull();
    expect(data).toBeDefined();

    const result = data as { transaction_id: string; new_balance: number; type: string };
    expect(result.new_balance).toBe(150);
    expect(result.type).toBe("admin_credit");

    // Verify user balance updated
    const { data: user } = await serviceClient
      .from("users")
      .select("balance_usd")
      .eq("id", targetUserId)
      .single();
    expect(user?.balance_usd).toBe(150);
  });

  // -----------------------------------------------------------------------
  // 3. Admin can debit user balance
  // -----------------------------------------------------------------------
  it("should debit user balance with correct PIN", async () => {
    const { data, error } = await adminClient.rpc("admin_adjust_balance", {
      p_user_id: targetUserId,
      p_amount: -30,
      p_description: "Test debit",
      p_pin: TEST_PIN,
    });
    expect(error).toBeNull();
    expect(data).toBeDefined();

    const result = data as { transaction_id: string; new_balance: number; type: string };
    expect(result.new_balance).toBe(120);
    expect(result.type).toBe("admin_debit");
  });

  // -----------------------------------------------------------------------
  // 4. Wrong PIN rejected
  // -----------------------------------------------------------------------
  it("should reject wrong PIN", async () => {
    const { error } = await adminClient.rpc("admin_adjust_balance", {
      p_user_id: targetUserId,
      p_amount: 10,
      p_description: "Should fail",
      p_pin: "9999",
    });
    expect(error).toBeDefined();
    expect(error!.message).toContain("Invalid PIN");
  });

  // -----------------------------------------------------------------------
  // 5. Debit exceeding balance rejected
  // -----------------------------------------------------------------------
  it("should reject debit exceeding user balance", async () => {
    const { error } = await adminClient.rpc("admin_adjust_balance", {
      p_user_id: targetUserId,
      p_amount: -9999,
      p_description: "Should fail",
      p_pin: TEST_PIN,
    });
    expect(error).toBeDefined();
    expect(error!.message).toContain("Insufficient balance");
  });

  // -----------------------------------------------------------------------
  // 6. Frozen user rejected
  // -----------------------------------------------------------------------
  it("should reject credit/debit for frozen user", async () => {
    // Freeze the target user
    await serviceClient.from("users").update({ is_frozen: true }).eq("id", targetUserId);

    const { error } = await adminClient.rpc("admin_adjust_balance", {
      p_user_id: targetUserId,
      p_amount: 10,
      p_description: "Should fail",
      p_pin: TEST_PIN,
    });
    expect(error).toBeDefined();
    expect(error!.message).toContain("frozen");

    // Unfreeze for subsequent tests
    await serviceClient.from("users").update({ is_frozen: false }).eq("id", targetUserId);
  });

  // -----------------------------------------------------------------------
  // 7. Audit trail created in system_logs
  // -----------------------------------------------------------------------
  it("should create audit log entry for admin credit", async () => {
    const { data } = await adminClient.rpc("admin_adjust_balance", {
      p_user_id: targetUserId,
      p_amount: 5,
      p_description: "Audit test",
      p_pin: TEST_PIN,
    });
    expect(data).toBeDefined();

    // Check system_logs for the audit entry
    const { data: logs } = await serviceClient
      .from("system_logs")
      .select("*")
      .eq("source", "admin/credit")
      .order("created_at", { ascending: false })
      .limit(1);

    expect(logs).toBeDefined();
    expect(logs!.length).toBeGreaterThan(0);
    expect(logs![0].context).toBeDefined();
    expect(logs![0].context.admin_id).toBe(adminUserId);
    expect(logs![0].context.user_id).toBe(targetUserId);
  });
});
