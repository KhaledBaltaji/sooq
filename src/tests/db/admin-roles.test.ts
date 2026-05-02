/**
 * admin-roles.test.ts — admin_set_admin_role RPC tests
 *
 * Regression test for migration 259 (fix for "function log_system_event(log_severity,
 * unknown, jsonb) does not exist" on production — migration 242 passed JSONB where
 * TEXT was expected).
 *
 * Covers: super admin promotes / demotes user, non-super-admin rejected, self-edit
 * rejected, system_logs audit row is written with correct shape.
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
let superAdminClient: SupabaseClient;
let superAdminUserId: string;
let subAdminClient: SupabaseClient;
let subAdminUserId: string;
let targetUserId: string;
const testUserIds: string[] = [];
const authCleanups: (() => Promise<void>)[] = [];

beforeAll(async () => {
  serviceClient = getServiceClient();

  // Super admin: is_admin=true, admin_allowed_views=NULL
  const superAuth = await createAuthenticatedClient(serviceClient, {
    is_admin: true,
    admin_allowed_views: null,
    balance_usd: 0,
  });
  superAdminClient = superAuth.client;
  superAdminUserId = superAuth.userId;
  testUserIds.push(superAdminUserId);
  authCleanups.push(superAuth.cleanup);

  // Sub-admin: is_admin=true, admin_allowed_views=['finance']
  const subAuth = await createAuthenticatedClient(serviceClient, {
    is_admin: true,
    admin_allowed_views: ["finance"],
    balance_usd: 0,
  });
  subAdminClient = subAuth.client;
  subAdminUserId = subAuth.userId;
  testUserIds.push(subAdminUserId);
  authCleanups.push(subAuth.cleanup);

  // Target user: regular user to promote/demote
  targetUserId = await createTestUser(serviceClient, { balance_usd: 100 });
  testUserIds.push(targetUserId);
});

afterAll(async () => {
  for (const fn of authCleanups) await fn();
  await cleanup(serviceClient, testUserIds, []);
});

describe("admin_set_admin_role", () => {
  // -----------------------------------------------------------------------
  // 1. Happy path: super admin promotes a user to sub-admin
  //    This would have failed before migration 259 with:
  //    "function log_system_event(log_severity, unknown, jsonb) does not exist"
  // -----------------------------------------------------------------------
  it("super admin can promote user to sub-admin with allowed views", async () => {
    const { data, error } = await superAdminClient.rpc("admin_set_admin_role", {
      p_user_id: targetUserId,
      p_is_admin: true,
      p_allowed_views: ["finance", "support"],
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({
      success: true,
      user_id: targetUserId,
      is_admin: true,
      admin_allowed_views: ["finance", "support"],
    });

    const { data: user } = await serviceClient
      .from("users")
      .select("is_admin, admin_allowed_views")
      .eq("id", targetUserId)
      .single();
    expect(user?.is_admin).toBe(true);
    expect(user?.admin_allowed_views).toEqual(["finance", "support"]);

    // Audit row written
    const { data: logs } = await serviceClient
      .from("system_logs")
      .select("severity, source, message, context")
      .eq("source", "admin/role_change")
      .order("created_at", { ascending: false })
      .limit(1);

    expect(logs).toBeDefined();
    expect(logs!.length).toBeGreaterThan(0);
    expect(logs![0].severity).toBe("warn");
    expect(logs![0].message).toBe("Admin role changed");
    expect(logs![0].context.caller_id).toBe(superAdminUserId);
    expect(logs![0].context.target_id).toBe(targetUserId);
    expect(logs![0].context.is_admin).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 2. Super admin revokes admin access
  // -----------------------------------------------------------------------
  it("super admin can revoke admin access", async () => {
    const { data, error } = await superAdminClient.rpc("admin_set_admin_role", {
      p_user_id: targetUserId,
      p_is_admin: false,
      p_allowed_views: null,
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ success: true, is_admin: false });

    const { data: user } = await serviceClient
      .from("users")
      .select("is_admin, admin_allowed_views")
      .eq("id", targetUserId)
      .single();
    expect(user?.is_admin).toBe(false);
    expect(user?.admin_allowed_views).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 3. Sub-admin cannot manage admin roles
  // -----------------------------------------------------------------------
  it("sub-admin is rejected with 'Only super admins can manage admin roles'", async () => {
    const { error } = await subAdminClient.rpc("admin_set_admin_role", {
      p_user_id: targetUserId,
      p_is_admin: true,
      p_allowed_views: ["finance"],
    });

    expect(error).toBeDefined();
    expect(error!.message).toContain("Only super admins");
  });

  // -----------------------------------------------------------------------
  // 4. Super admin cannot modify their own role
  // -----------------------------------------------------------------------
  it("super admin cannot modify their own role", async () => {
    const { error } = await superAdminClient.rpc("admin_set_admin_role", {
      p_user_id: superAdminUserId,
      p_is_admin: false,
      p_allowed_views: null,
    });

    expect(error).toBeDefined();
    expect(error!.message).toContain("Cannot modify your own admin role");
  });
});
