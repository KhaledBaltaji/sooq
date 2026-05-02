/**
 * speed-roll-markets.test.ts — Verifies mig 347's back-to-back roll +
 * (asset, duration, opens_at) UNIQUE constraint.
 *
 * Tests run against staging where the speed-roll cron is also firing every
 * minute. To stay deterministic without time-travel, the tests work with
 * whatever state the cron has produced and assert invariants rather than
 * exact creation counts:
 *
 *   1. After a call, a market exists at `_next_clean_boundary('5m', NOW())`.
 *   2. A second call within the same boundary produces zero new markets
 *      (idempotent — proves ON CONFLICT DO NOTHING works).
 *   3. Direct duplicate INSERT raises 23505 (constraint enforced).
 *   4. Master kill switch short-circuits the function (no creates).
 *
 * The master-kill test toggles the master switch in fee_config; a try/finally
 * restores the prior value even if assertions fail. Timing window where the
 * real cron sees `master_kill_active` is at most one cron tick (~60s); on
 * staging this is acceptable.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanup, getServiceClient } from "./helpers";

let sb: SupabaseClient;
const createdMarkets: string[] = [];

beforeAll(() => {
  sb = getServiceClient();
});

afterAll(async () => {
  if (createdMarkets.length > 0) {
    await sb.from("speed_markets").delete().in("id", createdMarkets);
  }
  await cleanup(sb, [], [], []);
});

async function nextCleanBoundaryUtc(durationMinutes: number): Promise<Date> {
  // Mirrors `_next_clean_boundary` for 5m/15m/1h durations. UTC-aligned —
  // matches Postgres' EXTRACT semantics on TIMESTAMPTZ.
  const now = new Date();
  const minutes = now.getUTCMinutes();
  const slot = Math.floor(minutes / durationMinutes) + 1;
  const boundary = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      slot * durationMinutes,
      0,
      0,
    ),
  );
  return boundary;
}

describe("speed_roll_markets back-to-back (mig 347)", () => {
  it("1. ensures a market exists at the next 5m clean boundary", async () => {
    const { data: result, error } = await sb.rpc("speed_roll_markets" as never);
    expect(error).toBeNull();
    expect(result).not.toBeNull();
    const r = result as Record<string, unknown>;
    expect(r.success).toBe(true);

    const boundary = await nextCleanBoundaryUtc(5);
    const { data: marketRow, error: selErr } = await sb
      .from("speed_markets")
      .select("id, opens_at, closes_at, status, strike_price")
      .eq("asset", "BTC")
      .eq("duration", "5m")
      .eq("opens_at", boundary.toISOString())
      .maybeSingle();
    expect(selErr).toBeNull();
    expect(marketRow).not.toBeNull();
    if (marketRow) {
      // Mig 350: future-boundary rows are inserted as 'pending' with
      // strike_price=NULL. They flip to 'open' (with strike set) the moment
      // the speed_oracle_latest trigger fires after opens_at. Because the
      // boundary here is in the future and the oracle worker is upserting
      // at 1Hz, we should always see status='pending' immediately after
      // speed_roll_markets() returns. Allow 'open' as a tolerance for the
      // edge case where the boundary == NOW() and the trigger races us.
      expect(["pending", "open"]).toContain(marketRow.status);
      if (marketRow.status === "pending") {
        expect(marketRow.strike_price).toBeNull();
      } else {
        expect(marketRow.strike_price).not.toBeNull();
      }
      const expectedClose = new Date(boundary.getTime() + 5 * 60_000).toISOString();
      expect(new Date(marketRow.closes_at).toISOString()).toBe(expectedClose);
    }
  }, 15_000);

  it("2. is idempotent — second call within the same boundary creates no duplicates", async () => {
    // Snapshot upcoming-boundary row count before
    const boundary = await nextCleanBoundaryUtc(5);
    const before = await sb
      .from("speed_markets")
      .select("id", { count: "exact", head: true })
      .eq("asset", "BTC")
      .eq("duration", "5m")
      .eq("opens_at", boundary.toISOString());
    const beforeCount = before.count ?? 0;

    const a = await sb.rpc("speed_roll_markets" as never);
    expect(a.error).toBeNull();
    const b = await sb.rpc("speed_roll_markets" as never);
    expect(b.error).toBeNull();

    const after = await sb
      .from("speed_markets")
      .select("id", { count: "exact", head: true })
      .eq("asset", "BTC")
      .eq("duration", "5m")
      .eq("opens_at", boundary.toISOString());
    const afterCount = after.count ?? 0;

    // After both calls, there should be exactly one row at this boundary —
    // even if before was 0 (we just created it) or 1 (already created by
    // an earlier call or the live cron).
    expect(afterCount).toBe(1);
    // And we never went above 1 mid-flight (would require >1 before the
    // second call, which would mean the constraint is broken).
    expect(beforeCount).toBeLessThanOrEqual(1);
  }, 15_000);

  it("3. UNIQUE constraint blocks a duplicate insert", async () => {
    const boundary = await nextCleanBoundaryUtc(5);

    // Try to insert a second BTC/5m market at the same opens_at as whatever
    // currently exists. We can't know the existing strike, but we don't need
    // to — the duplicate INSERT should fail purely on (asset, duration,
    // opens_at), regardless of any other column.
    const { error } = await sb.from("speed_markets").insert({
      asset: "BTC",
      duration: "5m",
      strike_price: 1, // arbitrary, doesn't matter
      opens_at: boundary.toISOString(),
      closes_at: new Date(boundary.getTime() + 5 * 60_000).toISOString(),
      status: "open",
    });
    expect(error).not.toBeNull();
    // Postgres unique_violation = 23505. Supabase JS surfaces it as code "23505".
    expect(error?.code).toBe("23505");
  }, 10_000);

  it("4. master kill switch short-circuits the function", async () => {
    // Snapshot current master kill value
    const { data: cur } = await sb
      .from("fee_config")
      .select("rate")
      .eq("fee_type", "speed_markets_enabled")
      .maybeSingle();
    const priorRate = cur ? Number(cur.rate) : 1;

    try {
      const { error: setErr } = await sb
        .from("fee_config")
        .update({ rate: 0 })
        .eq("fee_type", "speed_markets_enabled");
      expect(setErr).toBeNull();

      const { data: result, error } = await sb.rpc("speed_roll_markets" as never);
      expect(error).toBeNull();
      const r = result as Record<string, unknown>;
      expect(r.success).toBe(true);
      expect(r.skipped).toBe("master_kill_active");
      expect(r.created).toBe(0);
    } finally {
      // Always restore — failure to restore would block the live cron until
      // someone notices.
      await sb
        .from("fee_config")
        .update({ rate: priorRate })
        .eq("fee_type", "speed_markets_enabled");
    }
  }, 15_000);
});
