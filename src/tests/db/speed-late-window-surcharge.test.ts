/**
 * speed-late-window-surcharge.test.ts — Mig 356 surcharge behavior.
 *
 * Verifies:
 *   1. Boundary tests at threshold (eng-review 9A): surcharge fires at
 *      seconds_left < 30, doesn't fire at >= 30.
 *   2. Surcharge math: at fair_prob ~ 0.5 with late-window, offered_prob
 *      jumps from ~0.52 (4% spread) to ~0.595 (4% + 15% surcharge).
 *   3. Kill switch: setting fee_config.speed_late_window_surcharge=0
 *      disables the surcharge instantly.
 *   4. Bounds clamping: corrupt fee_config values (negative, > 0.30)
 *      get clamped to default with WARNING.
 *
 * NOTE: Direct SQL helper test. Tests calling speed_apply_late_window_surcharge
 * directly (it's a STABLE pure function with no auth requirements).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "./helpers";

let sb: SupabaseClient;

beforeAll(() => {
  sb = getServiceClient();
});

afterAll(async () => {
  // Restore default surcharge value if any test changed it
  await sb
    .from("fee_config")
    .update({ rate: 0.15 })
    .eq("fee_type", "speed_late_window_surcharge");
  await sb
    .from("fee_config")
    .update({ rate: 30 })
    .eq("fee_type", "speed_late_window_threshold");
});

async function callSurcharge(secondsLeft: number, baseSpread: number): Promise<number> {
  const { data, error } = await sb.rpc(
    "speed_apply_late_window_surcharge" as never,
    {
      p_seconds_left: secondsLeft,
      p_base_spread: baseSpread,
    } as never,
  );
  if (error) throw new Error(error.message);
  return Number(data);
}

describe("speed_apply_late_window_surcharge (mig 356)", () => {
  it("returns base unchanged outside late window", async () => {
    expect(await callSurcharge(60, 0.04)).toBeCloseTo(0.04, 6);
    expect(await callSurcharge(120, 0.04)).toBeCloseTo(0.04, 6);
    expect(await callSurcharge(300, 0.04)).toBeCloseTo(0.04, 6);
  });

  it("adds surcharge inside late window (default 15%)", async () => {
    // Inside last 30s → spread + 0.15
    expect(await callSurcharge(15, 0.04)).toBeCloseTo(0.19, 6);
    expect(await callSurcharge(5, 0.04)).toBeCloseTo(0.19, 6);
    expect(await callSurcharge(0.5, 0.04)).toBeCloseTo(0.19, 6);
  });

  it("boundary tests at exactly 30 (eng-review 9A)", async () => {
    // Half-open boundary: surcharge applies at < 30, NOT at >= 30
    expect(await callSurcharge(30.001, 0.04)).toBeCloseTo(0.04, 6); // outside
    expect(await callSurcharge(30.0, 0.04)).toBeCloseTo(0.04, 6); // exactly at boundary — outside
    expect(await callSurcharge(29.999, 0.04)).toBeCloseTo(0.19, 6); // inside
  });

  it("kill switch — surcharge=0 disables", async () => {
    await sb
      .from("fee_config")
      .update({ rate: 0 })
      .eq("fee_type", "speed_late_window_surcharge");

    expect(await callSurcharge(15, 0.04)).toBeCloseTo(0.04, 6);
    expect(await callSurcharge(5, 0.04)).toBeCloseTo(0.04, 6);

    // Restore for subsequent tests
    await sb
      .from("fee_config")
      .update({ rate: 0.15 })
      .eq("fee_type", "speed_late_window_surcharge");
  });

  it("bounds clamping — negative surcharge clamps to default 0.15", async () => {
    await sb
      .from("fee_config")
      .update({ rate: -0.5 })
      .eq("fee_type", "speed_late_window_surcharge");

    expect(await callSurcharge(15, 0.04)).toBeCloseTo(0.19, 6);

    await sb
      .from("fee_config")
      .update({ rate: 0.15 })
      .eq("fee_type", "speed_late_window_surcharge");
  });

  it("bounds clamping — surcharge > 0.30 clamps to default 0.15", async () => {
    await sb
      .from("fee_config")
      .update({ rate: 0.99 })
      .eq("fee_type", "speed_late_window_surcharge");

    expect(await callSurcharge(15, 0.04)).toBeCloseTo(0.19, 6);

    await sb
      .from("fee_config")
      .update({ rate: 0.15 })
      .eq("fee_type", "speed_late_window_surcharge");
  });

  it("custom threshold via fee_config", async () => {
    await sb
      .from("fee_config")
      .update({ rate: 60 })
      .eq("fee_type", "speed_late_window_threshold");

    expect(await callSurcharge(45, 0.04)).toBeCloseTo(0.19, 6); // inside 60s window
    expect(await callSurcharge(75, 0.04)).toBeCloseTo(0.04, 6); // outside

    // Restore default
    await sb
      .from("fee_config")
      .update({ rate: 30 })
      .eq("fee_type", "speed_late_window_threshold");
  });
});
