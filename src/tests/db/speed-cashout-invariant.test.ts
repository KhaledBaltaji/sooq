/**
 * speed-cashout-invariant.test.ts — LAUNCH GATE (eng-review 8A)
 *
 * Validates a critical math invariant codex flagged: a user who places a bet
 * and IMMEDIATELY cashes out (within seconds) must always lose money. If they
 * don't, there's a pricing-coherence arbitrage between entry and cashout.
 *
 * Concrete test:
 *   1. Place a $25 OVER bet on a fresh market.
 *   2. Wait < 5 seconds.
 *   3. Cash out.
 *   4. Assert cashout_amount < $25 (always lossy).
 *
 * The math invariant: at entry, offered_prob = fair + spread/2, so payout
 * multiplier = 1/offered. Right after entry, fair_prob is essentially
 * unchanged → fair_value ≈ stake × fair × (1/offered) = stake × (fair/offered).
 * Since offered > fair (due to spread), fair_value < stake. Then the cashout
 * multiplier (≤ 1.0) discounts further. Net: round-trip is always negative.
 *
 * If this test ever FAILS, there's a real arbitrage in the system — users
 * could bet and instantly cash out for free money. Pre-launch: must pass.
 *
 * Runs across 3 scenarios (early/mid/extreme strike distance) for coverage.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanup, createAuthenticatedClient, getServiceClient } from "./helpers";

let sb: SupabaseClient;
const createdUsers: string[] = [];
const createdMarkets: string[] = [];
const authCleanups: (() => Promise<void>)[] = [];

beforeAll(() => {
  sb = getServiceClient();
});

afterAll(async () => {
  for (const fn of authCleanups) {
    await fn().catch(() => {});
  }
  if (createdMarkets.length > 0) {
    await sb.from("speed_markets").delete().in("id", createdMarkets);
  }
  await cleanup(sb, createdUsers, [], []);
});

async function setupOracleTick(price: number): Promise<void> {
  const now = new Date().toISOString();
  await sb.from("speed_oracle_latest").upsert(
    { asset: "BTC", source: "binance", price, ts: now, received_at: now },
    { onConflict: "asset" },
  );
}

async function createOpenSpeedMarket(strike: number): Promise<string> {
  const { data, error } = await sb
    .from("speed_markets")
    .insert({
      asset: "BTC",
      duration: "5m",
      strike_price: strike,
      opens_at: new Date(Date.now() - 5_000).toISOString(),
      closes_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      status: "open",
    })
    .select("id")
    .single();
  if (error) throw new Error(`createOpenSpeedMarket failed: ${error.message}`);
  createdMarkets.push(data.id);
  return data.id as string;
}

describe("speed cashout invariant — immediate cashout always loses (eng-review 8A)", () => {
  it.each([
    { name: "at-the-money (50/50)", strike: 67_000, spot: 67_000, stake: 25 },
    { name: "moderately above strike", strike: 67_000, spot: 67_500, stake: 25 },
    { name: "moderately below strike", strike: 67_000, spot: 66_500, stake: 25 },
  ])(
    "$name: bet then immediate cashout must return less than stake",
    async ({ strike, spot, stake }) => {
      // Pre-fund main pool generously so cap doesn't trip on the test stake.
      await sb
        .from("speed_main_pool_state")
        .upsert(
          { id: 1, speed_pool_balance: 50_000, updated_at: new Date().toISOString() },
          { onConflict: "id" },
        );

      await setupOracleTick(spot);
      const marketId = await createOpenSpeedMarket(strike);

      const trader = await createAuthenticatedClient(sb, {
        balance_usd: 100,
        signup_branch_id: null,
      });
      authCleanups.push(trader.cleanup);
      createdUsers.push(trader.userId);

      // Place OVER bet
      await setupOracleTick(spot);
      const { data: tradeResult, error: tradeErr } = await trader.client.rpc(
        "speed_execute_trade" as never,
        {
          p_market_id: marketId,
          p_side: "over",
          p_stake: stake,
          p_idempotency_key: `invariant-trade-${marketId}-${Math.random()}`,
        } as never,
      );

      expect(tradeErr).toBeNull();
      expect(tradeResult).not.toBeNull();
      const trade = tradeResult as Record<string, unknown>;
      const positionId = trade.position_id as string;

      // Immediately cashout (no wait — fair prob essentially unchanged).
      // Refresh oracle tick because cashout requires fresh price.
      await setupOracleTick(spot);
      const { data: cashoutResult, error: cashoutErr } = await trader.client.rpc(
        "speed_execute_cashout" as never,
        {
          p_position_id: positionId,
          p_idempotency_key: `invariant-cashout-${marketId}-${Math.random()}`,
        } as never,
      );

      expect(cashoutErr).toBeNull();
      expect(cashoutResult).not.toBeNull();
      const cashout = cashoutResult as Record<string, unknown>;

      // THE CRITICAL INVARIANT: cashout_amount < stake
      // If this ever fails, there's an arbitrage — bet + immediate cashout
      // would print money. Launch blocker.
      const cashoutAmount = Number(cashout.cashout_amount);
      expect(cashoutAmount).toBeLessThan(stake);
      expect(cashoutAmount).toBeGreaterThanOrEqual(0); // sanity: never negative
    },
    30_000,
  );
});
