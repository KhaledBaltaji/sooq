/**
 * demo-seed-catalog.test.ts — asserts the demo seed catalog is intact
 *
 * Scoped to rows seeded by the `demo.seed.*` keyword prefix that seed
 * migrations write to `keywords`. Migration 272 seeded 20 markets;
 * migration 277 replaced that catalog with 5 fresh political markets
 * ending 2026-12-31 and 2027-12-31. Going forward, each seed-refresh
 * migration may change the count — the `>= N` assertion uses a soft
 * floor to absorb that.
 *
 * The prior version of this test selected ALL rows in `demo_markets`, which
 * flaked during parallel test runs that create + delete demo markets via
 * `admin_create_demo_market` — a transiently-visible market (or a test
 * cleanup that deletes `demo_markets` but not `demo_amm_state`) would fail
 * the amm_state assertion even though the seed catalog itself is intact.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { getServiceClient } from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

const SEED_KEYWORD_PREFIX = "demo.seed.";

/**
 * Returns only the markets seeded by migration 272. Looks for any element in
 * `keywords` that starts with `demo.seed.`. Ad-hoc markets created by other
 * tests (via admin_create_demo_market with a custom keywords array) don't
 * match this filter.
 */
async function selectSeedMarkets<T extends Record<string, unknown>>(
  client: SupabaseClient,
  columns: string,
): Promise<T[]> {
  // Build the select list dynamically — Supabase's typed client complains
  // about template-literal column strings, so cast through unknown.
  const selectList = `${columns}, keywords`;
  const { data, error } = await client
    .from("demo_markets")
    .select(selectList as unknown as "*");
  expect(error).toBeNull();
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  return rows.filter((row) => {
    const keywords = (row.keywords as string[] | null | undefined) ?? [];
    return keywords.some(
      (k) => typeof k === "string" && k.startsWith(SEED_KEYWORD_PREFIX),
    );
  }) as unknown as T[];
}

describe("Demo seed catalog", () => {
  let serviceClient: SupabaseClient;

  beforeAll(() => {
    serviceClient = getServiceClient();
  });

  it("has >= 5 bilingual demo markets", async () => {
    const seeds = await selectSeedMarkets<{
      id: string;
      question_en: string;
      question_ar: string;
    }>(serviceClient, "id, question_en, question_ar");

    expect(seeds.length).toBeGreaterThanOrEqual(5);
    for (const row of seeds) {
      expect(row.question_en.length).toBeGreaterThan(0);
      expect(row.question_ar.length).toBeGreaterThan(0);
    }
  });

  it("all seeded markets have a corresponding demo_amm_state row with b = 5000", async () => {
    const seeds = await selectSeedMarkets<{ id: string }>(serviceClient, "id");

    for (const m of seeds) {
      const { data: amm } = await serviceClient
        .from("demo_amm_state")
        .select("liquidity_param")
        .eq("market_id", m.id)
        .single();
      expect(amm).not.toBeNull();
      expect(Number(amm!.liquidity_param)).toBe(5000);
    }
  });

  it("all seeded markets have a matching scheduled_outcome with resolves_at after opens_at", async () => {
    const seeds = await selectSeedMarkets<{
      id: string;
      resolves_at: string;
      opens_at: string;
    }>(serviceClient, "id, resolves_at, opens_at");

    for (const m of seeds) {
      const { data: schedule } = await serviceClient
        .from("demo_market_scheduled_outcomes")
        .select("scheduled_outcome")
        .eq("market_id", m.id)
        .single();
      expect(schedule).not.toBeNull();
      expect(["yes", "no"]).toContain(schedule!.scheduled_outcome);
      // Migration-correctness check: resolves_at must be after opens_at.
      // Must not compare to Date.now() — the migration ran weeks ago, so
      // seeded resolves_at values have already passed even though the
      // migration computed them as future-dated at run time.
      expect(new Date(m.resolves_at).getTime()).toBeGreaterThan(
        new Date(m.opens_at).getTime()
      );
    }
  });
});
