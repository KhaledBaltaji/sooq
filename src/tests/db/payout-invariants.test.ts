/**
 * Payout Invariants -- Property-Based Database Tests (V3 AMM)
 *
 * Tests mathematical invariants that must hold for ANY market resolution
 * under the V3 LMSR AMM model.
 *
 * V3 changes:
 *   - AMM state in amm_state table
 *   - Winning shares pay $0.99 (1% resolution fee)
 *   - Uses execute_trade RPC (requires auth.uid())
 *   - Fee is 0.5% explicit on every buy/sell
 *
 * Invariants:
 *  1. Winners receive balance increase after resolution
 *  2. No user has negative balance after resolution
 *  3. SUM(transactions) = balance_usd for every user (ledger consistency)
 *  4. Losers' positions are worth $0 after resolution
 *  5. Total commission per trader is bounded
 *  6. Resolution fee is applied (winners get $0.99 per share, not $1.00)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  getServiceClient,
  createTestUser,
  createTestMarket,
  createAuthenticatedClient,
  fundUser,
  cleanup,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

let sb: SupabaseClient;
let createdUsers: string[] = [];
let createdMarkets: string[] = [];
let authCleanups: (() => Promise<void>)[] = [];

// Shared admin auth client — created once, reused for all resolutions
let sharedAdminClient: SupabaseClient;
let sharedAdminId: string;
let sharedAdminCleanup: () => Promise<void>;

const TEST_PIN = "123456";

beforeAll(async () => {
  sb = getServiceClient();

  // Create one authenticated admin for the entire test suite
  const adminAuth = await createAuthenticatedClient(sb, {
    is_admin: true,
    balance_usd: 50000,
  });
  sharedAdminClient = adminAuth.client;
  sharedAdminId = adminAuth.userId;
  sharedAdminCleanup = adminAuth.cleanup;

  // Set admin PIN (required for resolve_market since migration 176)
  const { error: pinError } = await sharedAdminClient.rpc("admin_set_pin", { p_pin: TEST_PIN });
  if (pinError) throw new Error(`admin_set_pin failed: ${pinError.message}`);
});

afterAll(async () => {
  await sharedAdminCleanup?.().catch(() => {});
});

afterEach(async () => {
  for (const fn of authCleanups) {
    await fn().catch(() => {});
  }
  authCleanups = [];
  await cleanup(sb, createdUsers, createdMarkets);
  createdUsers = [];
  createdMarkets = [];
});

// ---------------------------------------------------------------------------
// Helper: create authenticated trader
// ---------------------------------------------------------------------------
async function createTrader(
  overrides: Record<string, unknown> = {}
): Promise<{ client: SupabaseClient; userId: string }> {
  const result = await createAuthenticatedClient(sb, {
    balance_usd: 1000,
    ...overrides,
  });
  createdUsers.push(result.userId);
  authCleanups.push(result.cleanup);
  return { client: result.client, userId: result.userId };
}

// ---------------------------------------------------------------------------
// Helper: execute a trade
// ---------------------------------------------------------------------------
async function executeTrade(
  userClient: SupabaseClient,
  marketId: string,
  side: "yes" | "no",
  direction: "buy" | "sell",
  amount: number
) {
  const params: Record<string, unknown> = {
    p_market_id: marketId,
    p_side: side,
  };
  if (direction === "buy") {
    params.p_amount = amount;
  } else {
    params.p_shares_to_sell = amount;
  }
  const { data, error } = await userClient.rpc("execute_trade", params);
  if (error) throw new Error(`execute_trade failed: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Helper: resolve market via the shared authenticated admin client
// ---------------------------------------------------------------------------
async function resolveMarket(
  _adminId: string,
  marketId: string,
  outcome: "yes" | "no"
) {
  const { error } = await sharedAdminClient.rpc("resolve_market", {
    p_market_id: marketId,
    p_outcome: outcome,
    p_pin: TEST_PIN,
  });

  if (error) throw new Error(`resolve_market failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Helper: get user balance
// ---------------------------------------------------------------------------
async function getBalance(userId: string): Promise<number> {
  const { data } = await sb
    .from("users")
    .select("balance_usd")
    .eq("id", userId)
    .single();
  return Number(data?.balance_usd ?? 0);
}

// ---------------------------------------------------------------------------
// Helper: build a standard market scenario
// Each user places one trade on the market.
// ---------------------------------------------------------------------------
interface TraderSpec {
  side: "yes" | "no";
  amount: number;
}

async function buildAndResolve(
  traderSpecs: TraderSpec[],
  outcome: "yes" | "no"
): Promise<{
  admin: string;
  marketId: string;
  traders: { userId: string; side: "yes" | "no"; amount: number; balanceBefore: number }[];
}> {
  const admin = await createTestUser(sb, { is_admin: true });
  createdUsers.push(admin);

  const marketId = await createTestMarket(sb, admin);
  createdMarkets.push(marketId);

  const traders: {
    userId: string;
    side: "yes" | "no";
    amount: number;
    balanceBefore: number;
  }[] = [];

  for (const spec of traderSpecs) {
    const { client: traderClient, userId } = await createTrader({
      balance_usd: spec.amount + 100, // buffer for fees
    });

    const balanceBefore = await getBalance(userId);

    await executeTrade(traderClient, marketId, spec.side, "buy", spec.amount);

    traders.push({
      userId,
      side: spec.side,
      amount: spec.amount,
      balanceBefore,
    });
  }

  // Resolve
  await resolveMarket(admin, marketId, outcome);

  return { admin, marketId, traders };
}

// ======================================================================
// INVARIANT TESTS
// ======================================================================

describe("Payout Invariants (V3 AMM)", () => {
  // ====================================================================
  // 1. Winners receive balance increase after resolution
  // ====================================================================
  it("1. winners receive a payout (balance increases after resolution)", async () => {
    const { traders } = await buildAndResolve(
      [
        { side: "yes", amount: 10 },
        { side: "yes", amount: 6 },
        { side: "no", amount: 10 },
        { side: "no", amount: 6 },
      ],
      "yes"
    );

    // Winners (YES side) should have received some payout
    const winners = traders.filter((t) => t.side === "yes");
    for (const w of winners) {
      const balanceAfter = await getBalance(w.userId);
      const balanceAfterTrade = w.balanceBefore - w.amount; // approximate (ignoring fees)

      // After resolution, balance should be higher than post-trade balance
      // because winning shares pay out $0.99 each
      expect(balanceAfter).toBeGreaterThan(balanceAfterTrade);
    }
  });

  // ====================================================================
  // 2. No user has negative balance after resolution
  // ====================================================================
  it("2. no user has negative balance after resolution", async () => {
    const { admin, traders } = await buildAndResolve(
      [
        { side: "yes", amount: 10 },
        { side: "yes", amount: 6 },
        { side: "no", amount: 10 },
        { side: "no", amount: 6 },
        { side: "yes", amount: 5 },
        { side: "no", amount: 5 },
      ],
      "yes"
    );

    const allUserIds = [admin, ...traders.map((t) => t.userId)];
    for (const uid of allUserIds) {
      const balance = await getBalance(uid);
      expect(balance).toBeGreaterThanOrEqual(0);
    }
  });

  // ====================================================================
  // 3. SUM(transactions) = balance_usd for every user (ledger consistency)
  // ====================================================================
  it("3. ledger SUM(transactions) equals cached balance_usd (excluding agent wallet txns)", async () => {
    const { admin, traders } = await buildAndResolve(
      [
        { side: "yes", amount: 10 },
        { side: "no", amount: 10 },
        { side: "yes", amount: 6 },
        { side: "no", amount: 6 },
      ],
      "no"
    );

    // Only check traders (not admin) — admin's initial balance has no transaction
    for (const trader of traders) {
      const cachedBalance = await getBalance(trader.userId);

      // Exclude commission and agent_transfer_out transactions — those affect agent_balance_usd
      const { data: txns } = await sb
        .from("transactions")
        .select("amount, type")
        .eq("user_id", trader.userId);

      const portfolioTxns = (txns ?? []).filter(
        (t: any) => t.type !== "commission" && t.type !== "agent_transfer_out"
      );

      const ledgerSum = portfolioTxns.reduce(
        (sum: number, t: any) => sum + Number(t.amount),
        0
      );

      // Transactions track changes from trade/resolution.
      // Initial balance is set directly. So: cachedBalance = initialBalance + ledgerSum
      const initialBalance = trader.balanceBefore;
      expect(cachedBalance).toBeCloseTo(initialBalance + ledgerSum, 1);
    }
  });

  // ====================================================================
  // 4. Losers get no win payout
  // ====================================================================
  it("4. losers receive no win payout transaction", async () => {
    const { marketId, traders } = await buildAndResolve(
      [
        { side: "yes", amount: 10 },
        { side: "yes", amount: 10 },
        { side: "no", amount: 10 },
        { side: "no", amount: 6 },
      ],
      "yes"
    );

    // Pure losers (NO side only) should have no win transactions
    const losers = traders.filter((t) => t.side === "no");
    for (const loser of losers) {
      const { data: winTx } = await sb
        .from("transactions")
        .select("amount")
        .eq("user_id", loser.userId)
        .eq("reference_id", marketId)
        .eq("type", "win");

      const totalWin = (winTx ?? []).reduce(
        (sum: number, t: any) => sum + Number(t.amount),
        0
      );

      expect(totalWin).toBe(0);
    }
  });

  // ====================================================================
  // 5. Total commission per trader is bounded
  // ====================================================================
  it("5. total commission per trader per market is bounded and reasonable", async () => {
    // Create a referral chain for commission generation
    const agentA = await createTestUser(sb, {
      agent_level: 4,
      direct_referral_count: 250,
    });
    const agentB = await createTestUser(sb, {
      referred_by: agentA,
      referral_chain: [agentA],
      agent_level: 4,
      direct_referral_count: 200,
    });
    const agentC = await createTestUser(sb, {
      referred_by: agentB,
      referral_chain: [agentB, agentA],
      agent_level: 4,
      direct_referral_count: 200,
    });
    createdUsers.push(agentA, agentB, agentC);

    // Create a trader referred by agentC (3-deep chain, all L4)
    const { client: traderClient, userId: traderId } = await createTrader({
      referred_by: agentC,
      referral_chain: [agentC, agentB, agentA],
      balance_usd: 1000,
    });

    const admin = await createTestUser(sb, { is_admin: true });
    createdUsers.push(admin);

    const marketId = await createTestMarket(sb, admin);
    createdMarkets.push(marketId);

    // Place a trade
    await executeTrade(traderClient, marketId, "yes", "buy", 5);

    // Need someone on the other side
    const { client: fillerClient } = await createTrader({ balance_usd: 200 });
    await executeTrade(fillerClient, marketId, "no", "buy", 5);

    // Resolve
    await resolveMarket(admin, marketId, "yes");

    // Sum all commissions from this trader's trades
    const { data: comms } = await sb
      .from("referral_commissions")
      .select("commission_amount")
      .eq("market_id", marketId)
      .eq("trader_id", traderId);

    const totalComm = (comms ?? []).reduce(
      (sum: number, c: any) => sum + Number(c.commission_amount),
      0
    );

    // Commission is on total platform revenue (~5% of trade amount)
    // With 2 layers at max L4 rates (50% + 12% = 62%), commission is bounded
    // Total commission should be a small fraction of the trade amount
    expect(totalComm).toBeGreaterThanOrEqual(0);
    expect(totalComm).toBeLessThan(5); // Sanity: less than the trade amount
  });

  // ====================================================================
  // 6. Resolution fee is applied (winners get < $1.00 per share)
  // ====================================================================
  it("6. resolution fee: winners receive less than face value of shares", async () => {
    const { client: winnerClient, userId: winnerId } = await createTrader({
      balance_usd: 500,
    });

    const admin = await createTestUser(sb, { is_admin: true });
    createdUsers.push(admin);

    const marketId = await createTestMarket(sb, admin);
    createdMarkets.push(marketId);

    // Buy YES shares
    const tradeResult = await executeTrade(winnerClient, marketId, "yes", "buy", 5);
    const sharesOwned = tradeResult.shares;
    expect(sharesOwned).toBeGreaterThan(0);

    // Need NO side
    const { client: loserClient } = await createTrader({ balance_usd: 200 });
    await executeTrade(loserClient, marketId, "no", "buy", 5);

    const balanceBeforeResolve = await getBalance(winnerId);

    // Resolve YES
    await resolveMarket(admin, marketId, "yes");

    const balanceAfterResolve = await getBalance(winnerId);
    const payout = balanceAfterResolve - balanceBeforeResolve;

    // Payout should be positive
    expect(payout).toBeGreaterThan(0);

    // Payout should be less than shares * $1.00 (resolution fee takes 1%)
    // Each share pays $0.99 instead of $1.00
    expect(payout).toBeLessThanOrEqual(sharesOwned * 1.0);

    // Payout should be approximately shares * $0.99
    expect(payout).toBeCloseTo(sharesOwned * (1 - 0.01), 0); // RESOLUTION_FEE_RATE = 0.01
  });

  // ====================================================================
  // Stress: heavily asymmetric market
  // ====================================================================
  it("stress: invariants hold for heavily asymmetric market", async () => {
    // Many users on YES, few on NO
    const yesAmounts = [10, 6, 5];
    const noAmounts = [10, 5];

    const allTraders: { userId: string; side: "yes" | "no" }[] = [];

    const admin = await createTestUser(sb, { is_admin: true });
    createdUsers.push(admin);

    const marketId = await createTestMarket(sb, admin);
    createdMarkets.push(marketId);

    // Place YES trades
    for (const amount of yesAmounts) {
      const { client: tc, userId } = await createTrader({
        balance_usd: amount + 100,
      });
      await executeTrade(tc, marketId, "yes", "buy", amount);
      allTraders.push({ userId, side: "yes" });
    }

    // Place NO trades
    for (const amount of noAmounts) {
      const { client: tc, userId } = await createTrader({
        balance_usd: amount + 100,
      });
      await executeTrade(tc, marketId, "no", "buy", amount);
      allTraders.push({ userId, side: "no" });
    }

    // Resolve YES (heavily favored side)
    await resolveMarket(admin, marketId, "yes");

    // INV 2: no negative balances
    for (const t of allTraders) {
      const balance = await getBalance(t.userId);
      expect(balance).toBeGreaterThanOrEqual(0);
    }

    // INV 3: ledger consistency — balance changes match transaction sum
    // (initial balance_usd is injected directly without a transaction)
    // Exclude commission/agent_transfer_out txns (those affect agent_balance_usd)
    for (let i = 0; i < allTraders.length; i++) {
      const t = allTraders[i];
      const initialBalance = (i < yesAmounts.length ? yesAmounts[i] : noAmounts[i - yesAmounts.length]) + 100;
      const cachedBalance = await getBalance(t.userId);
      const { data: txns } = await sb
        .from("transactions")
        .select("amount, type")
        .eq("user_id", t.userId);
      const portfolioTxns = (txns ?? []).filter(
        (tx: any) => tx.type !== "commission" && tx.type !== "agent_transfer_out"
      );
      const ledgerSum = portfolioTxns.reduce(
        (sum: number, tx: any) => sum + Number(tx.amount),
        0
      );
      expect(cachedBalance).toBeCloseTo(initialBalance + ledgerSum, 1);
    }

    // INV 4: losers get no win payout
    const losers = allTraders.filter((t) => t.side === "no");
    for (const loser of losers) {
      const { data: winTx } = await sb
        .from("transactions")
        .select("amount")
        .eq("user_id", loser.userId)
        .eq("reference_id", marketId)
        .eq("type", "win");
      const totalWin = (winTx ?? []).reduce(
        (sum: number, tx: any) => sum + Number(tx.amount),
        0
      );
      expect(totalWin).toBe(0);
    }
  });
});
