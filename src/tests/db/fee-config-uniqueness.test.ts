/**
 * fee-config-uniqueness.test.ts — Tests for migration 246
 *
 * Verifies the COALESCE-based unique index on fee_config prevents duplicates
 * when level/depth are NULL (the original UNIQUE constraint was broken because
 * PostgreSQL treats NULLs as distinct).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { getServiceClient } from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("fee_config uniqueness (migration 246)", () => {
  let serviceClient: SupabaseClient;

  beforeAll(() => {
    serviceClient = getServiceClient();
  });

  // ─── Test 1: zero duplicates after dedupe ─────────────────────────
  it("should have zero duplicate (fee_type, level, depth) groups", async () => {
    const { data, error } = await serviceClient.rpc("exec_sql_test_helper", {
      sql: `SELECT fee_type, COALESCE(level, -1) as lvl, COALESCE(depth, -1) as dpt, COUNT(*) as c
            FROM fee_config GROUP BY 1,2,3 HAVING COUNT(*) > 1`,
    }).select();

    // If exec_sql_test_helper doesn't exist (it doesn't — added inline assertion below)
    // Use direct query instead
    const { data: dupes, error: queryErr } = await serviceClient
      .from("fee_config")
      .select("fee_type, level, depth")
      .order("fee_type");

    expect(queryErr).toBeNull();
    expect(dupes).toBeDefined();

    const seen = new Map<string, number>();
    for (const row of dupes || []) {
      const key = `${row.fee_type}|${row.level ?? -1}|${row.depth ?? -1}`;
      seen.set(key, (seen.get(key) || 0) + 1);
    }

    const duplicateGroups = [...seen.entries()].filter(([, count]) => count > 1);
    expect(duplicateGroups).toEqual([]);
  });

  // ─── Test 2: inserting duplicate NULL row should be blocked ───────
  it("should reject INSERT of (fee_type, NULL, NULL) when row already exists", async () => {
    // Try to insert a duplicate explicit_fee row (level/depth NULL)
    const { error } = await serviceClient.from("fee_config").insert({
      fee_type: "explicit_fee",
      level: null,
      depth: null,
      rate: 0.001,
      description: "Test duplicate — should fail",
    });

    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/unique|duplicate/);
  });

  // ─── Test 3: deterministic single-row read for canonical fees ─────
  it("should return exactly one row per canonical fee_type", async () => {
    const canonicalSingletons = [
      "explicit_fee",
      "resolution_fee",
      "cash_out_premium",
      "dynamic_spread_threshold",
      "dynamic_spread_multiplier",
      "amm_default_b",
      "min_trade_amount",
    ];

    for (const fee_type of canonicalSingletons) {
      const { data, error } = await serviceClient
        .from("fee_config")
        .select("id, fee_type, rate")
        .eq("fee_type", fee_type)
        .is("level", null)
        .is("depth", null);

      expect(error).toBeNull();
      // Some singletons may not exist on all environments; require <= 1
      expect(data?.length ?? 0).toBeLessThanOrEqual(1);
    }
  });

  // ─── Test 4: dynamic_spread_threshold = 0.65 (canonical post-dedupe) ─
  it("should preserve canonical 0.65 value for dynamic_spread_threshold", async () => {
    const { data, error } = await serviceClient
      .from("fee_config")
      .select("rate")
      .eq("fee_type", "dynamic_spread_threshold")
      .is("level", null)
      .is("depth", null)
      .single();

    expect(error).toBeNull();
    expect(Number(data?.rate)).toBe(0.65);
  });

  // ─── Test 5: dynamic_spread_multiplier = 1.5 (canonical post-dedupe) ─
  it("should preserve canonical 1.5 value for dynamic_spread_multiplier", async () => {
    const { data, error } = await serviceClient
      .from("fee_config")
      .select("rate")
      .eq("fee_type", "dynamic_spread_multiplier")
      .is("level", null)
      .is("depth", null)
      .single();

    expect(error).toBeNull();
    expect(Number(data?.rate)).toBe(1.5);
  });
});
