/**
 * submit-manual-deposit.test.ts — Manual Whish deposit end-to-end tests
 *
 * Tests the production client payload `p_amount: 0` — the user submits a
 * receipt-only deposit and the admin enters the real amount on approval.
 * Regression guard for the 005 ↔ 240 constraint/RPC mismatch that silently
 * rejected every submission until migration 276 relaxed the table CHECK.
 *
 * Scenarios:
 *   1. Happy path with production payload (p_amount=0) — row lands in
 *      pending_review with amount=0, proof_image_url stored as-is.
 *   2. Admin approval sets real amount — admin calls admin_review_deposit
 *      with p_amount=25, row flips to confirmed, balance credited,
 *      transactions ledger row written.
 *   3. Admin approval with zero is rejected — admin_review_deposit raises
 *      "Deposit amount must be greater than zero", locking in the
 *      approval-time positivity gate as the sole money-movement check.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cleanup,
  createAuthenticatedClient,
  getServiceClient,
} from "./helpers";

let sb: SupabaseClient;
const createdUsers: string[] = [];
const createdAdminConfigIds: string[] = [];
const authCleanups: (() => Promise<void>)[] = [];

// After migration 286, admin_review_deposit requires p_pin. Tests prime the
// admin's admin_config via admin_set_pin, pass this PIN on the RPC call,
// and clean up the admin_config row in afterAll.
const TEST_ADMIN_PIN = "1234";

beforeAll(() => {
  sb = getServiceClient();
});

afterAll(async () => {
  for (const fn of authCleanups) {
    await fn().catch(() => {});
  }
  if (createdAdminConfigIds.length > 0) {
    await sb.from("admin_config").delete().in("admin_user_id", createdAdminConfigIds);
  }
  await cleanup(sb, createdUsers, []);
});

describe("submit_manual_deposit — production payload (p_amount=0)", () => {
  it("persists a pending_review row with amount=0 and the given proof path", async () => {
    const user = await createAuthenticatedClient(sb, { balance_usd: 0 });
    createdUsers.push(user.userId);
    authCleanups.push(user.cleanup);

    const proofPath = `${user.userId}/${crypto.randomUUID()}.jpg`;

    const { data, error } = await user.client.rpc("submit_manual_deposit", {
      p_amount: 0,
      p_whish_number: null,
      p_proof_image_url: proofPath,
    });

    expect(error).toBeNull();
    const payload = data as {
      deposit_id: string;
      status: string;
      already_pending: boolean;
    };
    expect(payload.status).toBe("pending_review");
    expect(payload.already_pending).toBe(false);
    expect(payload.deposit_id).toBeTruthy();

    const { data: row } = await sb
      .from("deposits")
      .select("amount, status, provider, proof_image_url, user_id")
      .eq("id", payload.deposit_id)
      .single();

    expect(row).toBeTruthy();
    expect(Number(row!.amount)).toBe(0);
    expect(row!.status).toBe("pending_review");
    expect(row!.provider).toBe("whish_manual");
    expect(row!.proof_image_url).toBe(proofPath);
    expect(row!.user_id).toBe(user.userId);
  });

  it("admin approval with p_amount=25 confirms the row and credits the user", async () => {
    const user = await createAuthenticatedClient(sb, { balance_usd: 0 });
    createdUsers.push(user.userId);
    authCleanups.push(user.cleanup);

    const admin = await createAuthenticatedClient(sb, {
      is_admin: true,
      balance_usd: 0,
    });
    createdUsers.push(admin.userId);
    createdAdminConfigIds.push(admin.userId);
    authCleanups.push(admin.cleanup);

    // Prime admin PIN — required by migration 286 for admin_review_deposit
    await admin.client.rpc("admin_set_pin", { p_pin: TEST_ADMIN_PIN });

    const proofPath = `${user.userId}/${crypto.randomUUID()}.jpg`;

    const submit = await user.client.rpc("submit_manual_deposit", {
      p_amount: 0,
      p_whish_number: null,
      p_proof_image_url: proofPath,
    });
    expect(submit.error).toBeNull();
    const submitData = submit.data as { deposit_id: string };

    const approval = await admin.client.rpc("admin_review_deposit", {
      p_deposit_id: submitData.deposit_id,
      p_action: "approve",
      p_amount: 25,
      p_pin: TEST_ADMIN_PIN,
    });
    expect(approval.error).toBeNull();
    const approvalData = approval.data as {
      status: string;
      amount: number;
      net_amount: number;
    };
    // Migration 286 changed the return from 'approved' → 'confirmed' to match
    // the actual deposit row status (single source of truth). Accept either
    // for backward compat during the migration rollout, then tighten to 'confirmed'.
    expect(["approved", "confirmed"]).toContain(approvalData.status);
    expect(Number(approvalData.amount)).toBe(25);

    const { data: row } = await sb
      .from("deposits")
      .select("amount, net_amount, fee, status, confirmed_at")
      .eq("id", submitData.deposit_id)
      .single();
    expect(row).toBeTruthy();
    expect(Number(row!.amount)).toBe(25);
    expect(row!.status).toBe("confirmed");
    expect(row!.confirmed_at).toBeTruthy();
    // fee + net_amount must reconcile
    expect(Number(row!.fee) + Number(row!.net_amount)).toBeCloseTo(25, 5);

    const { data: userRow } = await sb
      .from("users")
      .select("balance_usd")
      .eq("id", user.userId)
      .single();
    expect(Number(userRow!.balance_usd)).toBeCloseTo(Number(row!.net_amount), 5);

    const { data: tx } = await sb
      .from("transactions")
      .select("type, amount, balance_after, reference_id")
      .eq("user_id", user.userId)
      .eq("type", "deposit")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(tx).toBeTruthy();
    expect(Number(tx!.amount)).toBeCloseTo(Number(row!.net_amount), 5);
    expect(Number(tx!.balance_after)).toBeCloseTo(Number(userRow!.balance_usd), 5);
    expect(tx!.reference_id).toBe(submitData.deposit_id);
  });

  it("admin approval with p_amount=0 is rejected by the approval-time gate", async () => {
    const user = await createAuthenticatedClient(sb, { balance_usd: 0 });
    createdUsers.push(user.userId);
    authCleanups.push(user.cleanup);

    const admin = await createAuthenticatedClient(sb, {
      is_admin: true,
      balance_usd: 0,
    });
    createdUsers.push(admin.userId);
    createdAdminConfigIds.push(admin.userId);
    authCleanups.push(admin.cleanup);

    await admin.client.rpc("admin_set_pin", { p_pin: TEST_ADMIN_PIN });

    const submit = await user.client.rpc("submit_manual_deposit", {
      p_amount: 0,
      p_whish_number: null,
      p_proof_image_url: `${user.userId}/${crypto.randomUUID()}.jpg`,
    });
    expect(submit.error).toBeNull();
    const submitData = submit.data as { deposit_id: string };

    const approval = await admin.client.rpc("admin_review_deposit", {
      p_deposit_id: submitData.deposit_id,
      p_action: "approve",
      p_amount: 0,
      p_pin: TEST_ADMIN_PIN,
    });
    expect(approval.error).not.toBeNull();
    expect(approval.error!.message).toMatch(/greater than zero/i);

    // Row stays in pending_review — approval was aborted.
    const { data: row } = await sb
      .from("deposits")
      .select("status, amount")
      .eq("id", submitData.deposit_id)
      .single();
    expect(row!.status).toBe("pending_review");
    expect(Number(row!.amount)).toBe(0);
  });
});
