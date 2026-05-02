/**
 * speed-strike-finalize.test.ts — Verifies mig 350's lazy strike capture.
 *
 * Mig 350 decouples market creation from strike capture. New rows are
 * inserted as `status='pending'` with `strike_price=NULL`. Strike is set
 * at opens_at via:
 *   (a) a trigger on speed_oracle_latest UPDATE (1Hz from worker), OR
 *   (b) the speed_finalize_pending_markets() RPC called by speed_roll_markets()
 *       as defense-in-depth.
 *
 * These tests stand up synthetic pending markets at off-boundary timestamps
 * (so we don't collide with the live cron's UNIQUE-constrained slots) and
 * exercise both finalization paths.
 *
 * Each test cleans up its own rows; rate-limit tolerated via small retries.
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

/**
 * Helper: insert a synthetic pending speed_market at an off-clock-boundary
 * timestamp. Returns the inserted row's id.
 *
 * Off-boundary opens_at avoids colliding with the live speed_roll_markets
 * cron, which only inserts at clean boundaries (mig 341 / 347).
 */
async function insertPendingMarket(
  duration: "5m" | "15m" | "1h" | "24h",
  opensAtOffsetMs: number,
): Promise<string> {
  const opensAt = new Date(Date.now() + opensAtOffsetMs);
  const durMs =
    duration === "5m" ? 5 * 60_000
      : duration === "15m" ? 15 * 60_000
      : duration === "1h" ? 60 * 60_000
      : 24 * 60 * 60_000;
  // Use 13ms / 17ms / 19ms etc offsets so opens_at can never land on a
  // clock-aligned boundary that the cron might also try to insert.
  // Offset is added by caller via opensAtOffsetMs; here we add 137 ms more
  // to guarantee no clock-alignment collision regardless of the offset shape.
  const opensAtIso = new Date(opensAt.getTime() + 137).toISOString();
  const closesAtIso = new Date(opensAt.getTime() + 137 + durMs).toISOString();

  const { data, error } = await sb
    .from("speed_markets")
    .insert({
      asset: "BTC",
      duration,
      strike_price: null,
      opens_at: opensAtIso,
      closes_at: closesAtIso,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  createdMarkets.push(id);
  return id;
}

describe("speed_finalize_pending_markets (mig 350)", () => {
  it("1. finalizes a pending market whose opens_at has arrived", async () => {
    // Pending row with opens_at 30 seconds in the past — eligible.
    const id = await insertPendingMarket("5m", -30_000);

    // Snapshot oracle so we can assert strike came from there
    const { data: oracleRow, error: oErr } = await sb
      .from("speed_oracle_latest")
      .select("price")
      .eq("asset", "BTC")
      .single();
    expect(oErr).toBeNull();
    const oraclePriceBefore = Number((oracleRow as { price: string }).price);

    // Direct RPC. NOTE: speed_roll_markets() runs every minute via pg_cron and
    // calls speed_finalize_pending_markets() at the end. If the cron lands
    // between our insert and this RPC call, our market is already finalized
    // and the RPC returns 0 — but the row will be in 'open' state. So we
    // assert "either our RPC finalized it, OR the cron raced and finalized
    // it for us" — both prove the function works.
    const { data: count, error } = await sb.rpc(
      "speed_finalize_pending_markets" as never,
    );
    expect(error).toBeNull();
    expect(typeof count).toBe("number");

    const { data: row, error: selErr } = await sb
      .from("speed_markets")
      .select("status, strike_price")
      .eq("id", id)
      .single();
    expect(selErr).toBeNull();
    expect((row as { status: string }).status).toBe("open");

    // Race-tolerant: count must be ≥1 unless the cron already finalized our
    // row (in which case status is already 'open' from the assert above).
    const ranByUs = (count as unknown as number) >= 1;
    const ranByCron = (row as { status: string }).status === "open";
    expect(ranByUs || ranByCron).toBe(true);

    const strike = Number((row as { strike_price: string }).strike_price);
    expect(strike).toBeGreaterThan(0);
    // Strike was sourced from speed_oracle_latest at finalize time. The
    // worker upserts at 1Hz so the price may have moved a few cents between
    // our snapshot and the finalize call — assert it's within 0.5%.
    const driftPct = Math.abs(strike - oraclePriceBefore) / oraclePriceBefore;
    expect(driftPct).toBeLessThan(0.005);
  }, 15_000);

  it("2. leaves pending markets with future opens_at untouched", async () => {
    // Pending row with opens_at 5 minutes in the future — NOT eligible.
    const id = await insertPendingMarket("5m", 5 * 60_000);

    const { error } = await sb.rpc("speed_finalize_pending_markets" as never);
    expect(error).toBeNull();

    const { data: row, error: selErr } = await sb
      .from("speed_markets")
      .select("status, strike_price")
      .eq("id", id)
      .single();
    expect(selErr).toBeNull();
    expect((row as { status: string }).status).toBe("pending");
    expect((row as { strike_price: string | null }).strike_price).toBeNull();
  }, 10_000);

  it("3. speed_roll_markets returns a 'finalized' field (defense-in-depth)", async () => {
    // Seed a pending row with past opens_at so the cron's tail-pass picks it up.
    const id = await insertPendingMarket("15m", -45_000);

    const { data: result, error } = await sb.rpc("speed_roll_markets" as never);
    expect(error).toBeNull();
    expect(result).not.toBeNull();
    const r = result as Record<string, unknown>;
    expect(r.success).toBe(true);
    // The new contract: response includes a numeric 'finalized' field.
    expect(typeof r.finalized).toBe("number");
    expect(r.finalized as number).toBeGreaterThanOrEqual(1);

    const { data: row } = await sb
      .from("speed_markets")
      .select("status, strike_price")
      .eq("id", id)
      .single();
    expect((row as { status: string }).status).toBe("open");
    expect((row as { strike_price: string | null }).strike_price).not.toBeNull();
  }, 15_000);

  it("4. trigger fires on speed_oracle_latest UPDATE", async () => {
    // Pending row with opens_at 10 sec in the past — eligible.
    const id = await insertPendingMarket("1h", -10_000);

    // Force a no-op UPDATE on speed_oracle_latest. AFTER UPDATE FOR EACH
    // STATEMENT triggers fire even when no column values change.
    const { data: cur } = await sb
      .from("speed_oracle_latest")
      .select("source")
      .eq("asset", "BTC")
      .single();
    const source = (cur as { source: string }).source;
    const { error: upErr } = await sb
      .from("speed_oracle_latest")
      .update({ source })
      .eq("asset", "BTC");
    expect(upErr).toBeNull();

    const { data: row } = await sb
      .from("speed_markets")
      .select("status, strike_price")
      .eq("id", id)
      .single();
    expect((row as { status: string }).status).toBe("open");
    expect((row as { strike_price: string | null }).strike_price).not.toBeNull();
  }, 15_000);

  it("5. CHECK constraint allows NULL strike on pending, requires > 0 elsewhere", async () => {
    // Negative strike must fail under the new CHECK.
    const opensAt = new Date(Date.now() + 7 * 60_000 + 211).toISOString();
    const closesAt = new Date(
      Date.now() + 7 * 60_000 + 211 + 5 * 60_000,
    ).toISOString();

    const { error: negErr } = await sb.from("speed_markets").insert({
      asset: "BTC",
      duration: "5m",
      strike_price: -1,
      opens_at: opensAt,
      closes_at: closesAt,
      status: "pending",
    });
    expect(negErr).not.toBeNull();
    // Postgres check_violation = 23514
    expect(negErr?.code).toBe("23514");
  }, 10_000);
});
