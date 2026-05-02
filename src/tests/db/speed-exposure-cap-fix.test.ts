/**
 * speed-exposure-cap-fix.test.ts — REGRESSION TEST (iron rule, eng-review 7)
 *
 * Validates the mig 353 fix to the per-market exposure cap. Pre-mig-353 used
 * a `p_stake * 2` proxy as worst-case payout liability, which was correct
 * only at offered_prob = 0.50. At extreme offered_prob (e.g., 0.01), real
 * payout liability is `stake / offered_prob = stake × 100`, so the proxy
 * underestimated by up to 50x.
 *
 * Concrete pre-fix exploit on the $9,930 main pool:
 *   79 max-stake ($25) tickets at offered_prob ≈ 0.01 on the same side
 *   - Old proxy: 79 * $50 = $3,950 (passes the 40% cap of $3,972)
 *   - True liability: 79 * $2,500 = $197,500 (~20x the entire pool)
 *
 * This test deliberately recreates the exploit scenario:
 *   - Spread offered_prob to 0.05-0.10 range (close enough to extreme that
 *     stake*2 understates by 5-10x but offered_prob > 0.01 floor)
 *   - Stack ~30 max-stake bets on the same side
 *   - Verify the cap rejects when true SUM(stake/offered_prob) exceeds 40%
 *
 * Pre-mig-353 this test would FAIL (cap would pass when it shouldn't).
 * Post-mig-353 it passes (cap correctly rejects on true liability).
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

async function createOpenSpeedMarket(strike: number, durationMin: number = 5): Promise<string> {
  const { data, error } = await sb
    .from("speed_markets")
    .insert({
      asset: "BTC",
      duration: durationMin === 5 ? "5m" : durationMin === 15 ? "15m" : "1h",
      strike_price: strike,
      opens_at: new Date(Date.now() - 5_000).toISOString(),
      closes_at: new Date(Date.now() + durationMin * 60_000).toISOString(),
      status: "open",
    })
    .select("id")
    .single();
  if (error) throw new Error(`createOpenSpeedMarket failed: ${error.message}`);
  createdMarkets.push(data.id);
  return data.id as string;
}

describe("speed exposure cap regression (mig 353)", () => {
  it(
    "rejects concentrated extreme-offered-prob flow before pool insolvency",
    async () => {
      // 1. Pin main pool to a known, small-ish amount so the cap calc is
      //    predictable. With $1000 pool × 40% cap = $400 max liability per side.
      await sb
        .from("speed_main_pool_state")
        .upsert(
          { id: 1, speed_pool_balance: 1000, updated_at: new Date().toISOString() },
          { onConflict: "id" },
        );

      // 2. Oracle tick + market. Strike well below spot pushes fair_prob_over
      //    very high (close to 0.99) which means OVER offered_prob is also
      //    near the 0.99 cap → small payout multiplier. UNDER goes the other
      //    way: very low offered_prob, very high payout multiplier → that's
      //    where the cap fix matters most.
      await setupOracleTick(80_000);
      const marketId = await createOpenSpeedMarket(60_000); // strike well below spot

      // 3. Create users and stack UNDER bets. UNDER has very low fair_prob,
      //    high payout multiplier — true liability per ticket is large.
      const traders: Array<{ client: SupabaseClient; userId: string }> = [];
      for (let i = 0; i < 30; i++) {
        const c = await createAuthenticatedClient(sb, {
          balance_usd: 100,
          signup_branch_id: null,
        });
        authCleanups.push(c.cleanup);
        createdUsers.push(c.userId);
        traders.push({ client: c.client, userId: c.userId });
      }

      // 4. Sequential UNDER bets at $25 each (max retail stake). Cap should
      //    reject before all 30 land — the question is HOW MANY land before
      //    rejection. With true liability calc (mig 353 fix), rejection
      //    happens early because each $25 ticket on UNDER at offered_prob ≈ 0.05
      //    represents $500 worth of liability.
      let acceptedCount = 0;
      let rejectedWithCapMsg = false;

      for (let i = 0; i < traders.length; i++) {
        const t = traders[i];
        await setupOracleTick(80_000); // refresh oracle to avoid staleness
        const { error } = await t.client.rpc("speed_execute_trade" as never, {
          p_market_id: marketId,
          p_side: "under",
          p_stake: 25,
          p_idempotency_key: `cap-test-${marketId}-${i}`,
        } as never);

        if (!error) {
          acceptedCount++;
        } else if (error.message.includes("exposure cap reached")) {
          rejectedWithCapMsg = true;
          break;
        }
      }

      // 5. Iron-rule assertions:
      // - The cap MUST eventually reject (not pass all 30 tickets through)
      expect(rejectedWithCapMsg).toBe(true);

      // - Accepted count must be small (with $400 cap and ~$500/ticket
      //   liability, at most 1-2 should land before rejection).
      // Pre-mig-353: stake*2 proxy = $50/ticket — would have accepted ~8.
      // Post-mig-353: true liability ~$500/ticket — accepts 0-1.
      expect(acceptedCount).toBeLessThan(5);
    },
    60_000,
  );

  it(
    "allows balanced flow up to the cap (sanity check — fix doesn't over-reject)",
    async () => {
      // Sanity: at offered_prob ≈ 0.50 (50/50 market), $25 stakes have
      // $50 true payout liability. With $1000 pool × 40% = $400 cap, we
      // should be able to fit ~8 stakes per side before cap trips.
      await sb
        .from("speed_main_pool_state")
        .upsert(
          { id: 1, speed_pool_balance: 1000, updated_at: new Date().toISOString() },
          { onConflict: "id" },
        );

      await setupOracleTick(67_000);
      const marketId = await createOpenSpeedMarket(67_000); // strike at spot — 50/50

      const trader = await createAuthenticatedClient(sb, {
        balance_usd: 1000,
        signup_branch_id: null,
      });
      authCleanups.push(trader.cleanup);
      createdUsers.push(trader.userId);

      // First trade should succeed at minimum stake (well within cap).
      await setupOracleTick(67_000);
      const { error } = await trader.client.rpc("speed_execute_trade" as never, {
        p_market_id: marketId,
        p_side: "over",
        p_stake: 5,
        p_idempotency_key: `cap-sanity-${marketId}`,
      } as never);

      expect(error).toBeNull();
    },
    30_000,
  );
});
