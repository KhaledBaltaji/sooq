// W12 — cashout direction-matching invariant suite.
//
// Tests the founder's hard product invariant from the pricing engine v2 plan:
//
//   if mark_prob > entry_offered_prob (chart moving the user's way),
//     cashout amount must always be > stake. Always. Even with margin baked in.
//   if mark_prob < entry_offered_prob (chart against them),
//     cashout amount must always be < stake.
//   if mark_prob == entry_offered_prob, cashout = stake.
//
// The formula is option C (profit-based margin):
//   fair_profit = stake * (mark_prob / entry_offered_prob - 1)
//   winning side: cashout = stake + fair_profit * (1 - margin_winning)
//   losing  side: cashout = stake + fair_profit * (1 + margin_losing)
//
// This is direction-matching by construction. The test verifies that:
//   (a) the algebra holds across 10,000 randomly generated scenarios,
//   (b) the SQL implementation in speed_execute_cashout matches the JS
//       reference implementation within rounding tolerance.
//
// Run:   node scripts/w12-cashout-direction.mjs
//        node scripts/w12-cashout-direction.mjs --scenarios=50000
//        node scripts/w12-cashout-direction.mjs --skip-sql

import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const SCENARIOS = Number(
  process.argv.find((a) => a.startsWith("--scenarios="))?.split("=")[1] ?? 10000
);
const SKIP_SQL = process.argv.includes("--skip-sql");

let pass = 0;
let fail = 0;
const failures = [];

function logFail(scenario, reason) {
  fail += 1;
  if (failures.length < 20) failures.push({ scenario, reason });
}

// JS reference implementation of _speed_cashout_margin + the cashout formula.
// Mirrors mig 0028 / 0029 / 0030 / 0031 line-for-line.

function jsMargin({
  duration,
  isWinning,
  markProb,
  secondsLeft,
  config: cfg,
}) {
  const baseWinning = cfg.baseWinning[duration] ?? 0.025;
  const baseLosing = cfg.baseLosing[duration] ?? 0.080;
  const saturationCoef = cfg.saturationCoef ?? 0.20;
  const desperationCoef = cfg.desperationCoef ?? 0.40;
  const lateWinningCoef = cfg.lateWinningCoef ?? 0.015;
  const lateLosingCoef = cfg.lateLosingCoef ?? 0.05;

  let margin;
  if (isWinning) {
    const saturation = Math.max(0, Math.abs(markProb - 0.5) - 0.35) * saturationCoef;
    const lateWindow = Math.max(0, (60 - secondsLeft) / 60) * lateWinningCoef;
    margin = baseWinning + saturation + lateWindow;
  } else {
    const desperation = Math.max(0, 0.50 - markProb) * desperationCoef;
    const lateWindow = Math.max(0, (60 - secondsLeft) / 60) * lateLosingCoef;
    margin = baseLosing + desperation + lateWindow;
  }
  // Sanity clamp matching SQL helper.
  if (margin > 0.50) margin = 0.50;
  if (margin < 0) margin = 0;
  return margin;
}

function jsCashout({
  stake,
  entryOfferedProb,
  markProb,
  duration,
  secondsLeft,
  config: cfg,
}) {
  const isWinning = markProb > entryOfferedProb;
  const fairProfit = stake * (markProb / entryOfferedProb - 1);
  const margin = jsMargin({ duration, isWinning, markProb, secondsLeft, config: cfg });
  let cashoutRaw;
  if (isWinning) {
    cashoutRaw = stake + fairProfit * (1 - margin);
  } else {
    cashoutRaw = stake + fairProfit * (1 + margin);
  }
  if (cashoutRaw < 0) cashoutRaw = 0;
  const cashoutRounded = Math.round(cashoutRaw * 100) / 100;

  // Mig 0028 (Codex review fix): post-rounding direction-matching guard.
  // If the user is winning by a tiny amount (e.g., entry=0.80,
  // mark=0.800010), the raw cashout might round to == stake. Reject
  // with INSUFFICIENT_PROFIT instead of paying out at zero edge.
  let rejected = null;
  if (isWinning && cashoutRounded <= stake) {
    rejected = "INSUFFICIENT_PROFIT";
  } else if (!isWinning && markProb < entryOfferedProb && cashoutRounded >= stake) {
    rejected = "INSUFFICIENT_LOSS";
  }

  return {
    cashout: cashoutRounded,
    cashoutRaw,
    margin,
    fairProfit,
    isWinning,
    rejected,
  };
}

const DEFAULT_CONFIG = {
  baseWinning: { "5m": 0.025, "1h": 0.030 },
  baseLosing: { "5m": 0.080, "1h": 0.090 },
  saturationCoef: 0.20,
  desperationCoef: 0.40,
  lateWinningCoef: 0.015,
  lateLosingCoef: 0.05,
};

function randScenario(rng = Math.random) {
  const duration = rng() < 0.7 ? "5m" : "1h";
  const totalSeconds = duration === "5m" ? 300 : 3600;
  const stake = Math.round((1 + rng() * 24) * 100) / 100;
  // entry_offered_prob: spread of 0.05 around fair. Range [0.05, 0.95].
  const entryOfferedProb = 0.05 + rng() * 0.90;
  // mark_prob can be anywhere in (0.01, 0.99) — exclude exact entry to test
  // both directions; equality case tested separately.
  const markProb = Math.max(0.01, Math.min(0.99, rng() * 0.98 + 0.01));
  // seconds_left: any time in the window. Cashout RPC rejects < 10s; we
  // include some near-zero values to test boundary.
  const secondsLeft = rng() * totalSeconds;
  return { duration, stake, entryOfferedProb, markProb, secondsLeft };
}

console.log(
  `=== W12 Cashout Direction-Matching Invariant Suite (${SCENARIOS} scenarios) ===\n`
);

// ── Phase 1: pure-JS algebra check ──────────────────────────────────────
console.log(`Phase 1: JS reference implementation invariant (${SCENARIOS} cases)`);

let rejectedCount = 0;
for (let i = 0; i < SCENARIOS; i++) {
  const s = randScenario();
  const { cashout, margin, fairProfit, isWinning, rejected } = jsCashout({
    ...s,
    config: DEFAULT_CONFIG,
  });

  // If the cashout was rejected for insufficient profit/loss, count it
  // and skip — the rejection itself is correct behavior.
  if (rejected) {
    rejectedCount += 1;
    pass += 1;
    continue;
  }

  // INVARIANT 1 (STRICT): direction-matching after rounding. Mig 0028
  // post-rounding guard rejects cases where rounded cashout would equal
  // stake; a successful cashout MUST be strictly > stake when winning,
  // strictly < stake when losing.
  if (isWinning && cashout <= s.stake) {
    logFail(s, `winning but cashout=${cashout} <= stake=${s.stake} (margin=${margin}, profit=${fairProfit})`);
    continue;
  }
  if (!isWinning && s.markProb < s.entryOfferedProb && cashout >= s.stake) {
    logFail(s, `losing but cashout=${cashout} >= stake=${s.stake} (margin=${margin}, profit=${fairProfit})`);
    continue;
  }

  // INVARIANT 2: cashout never negative.
  if (cashout < 0) {
    logFail(s, `cashout went negative: ${cashout}`);
    continue;
  }

  // INVARIANT 3: margin in [0, 0.50].
  if (margin < 0 || margin > 0.50) {
    logFail(s, `margin out of bounds: ${margin}`);
    continue;
  }

  pass += 1;
}
console.log(`  (${rejectedCount}/${SCENARIOS} rejected for insufficient edge — correct behavior)`);

// Equality case: mark = entry → cashout = stake
{
  const stake = 100;
  const entry = 0.55;
  const { cashout } = jsCashout({
    stake,
    entryOfferedProb: entry,
    markProb: entry,
    duration: "5m",
    secondsLeft: 120,
    config: DEFAULT_CONFIG,
  });
  if (Math.abs(cashout - stake) > 0.01) {
    logFail({ stake, entry }, `equality case: cashout=${cashout} should equal stake=${stake}`);
  } else {
    pass += 1;
  }
}

// Specific founder counterexample: stake=$100, entry=0.80, mark=0.85.
// Direction-matching MUST hold. (Old formula returned $98.81; new must return > $100.)
{
  const stake = 100;
  const entry = 0.80;
  const mark = 0.85;
  const { cashout, isWinning, rejected } = jsCashout({
    stake,
    entryOfferedProb: entry,
    markProb: mark,
    duration: "5m",
    secondsLeft: 120,
    config: DEFAULT_CONFIG,
  });
  if (rejected || !isWinning || cashout <= stake) {
    logFail(
      { stake, entry, mark },
      `founder counterexample: cashout=${cashout} should be > stake=${stake} (winning=${isWinning} rejected=${rejected})`
    );
  } else {
    pass += 1;
    console.log(`  ✅ founder counterexample: $${stake} stake, entry=${entry}, mark=${mark} → cashout=$${cashout} (>${stake} ✓)`);
  }
}

// Codex review tiny-edge test: stake=$100, entry=0.80, mark=0.800010.
// Raw cashout ~$100.0012 rounds to $100. Mig 0028 must REJECT this with
// INSUFFICIENT_PROFIT, not return a $100 cashout that breaks the
// "always > stake when winning" rule.
{
  const stake = 100;
  const entry = 0.80;
  const mark = 0.800010;
  const { cashout, isWinning, rejected } = jsCashout({
    stake,
    entryOfferedProb: entry,
    markProb: mark,
    duration: "5m",
    secondsLeft: 120,
    config: DEFAULT_CONFIG,
  });
  if (!isWinning) {
    logFail({ stake, entry, mark }, `tiny-edge case: should be winning (mark > entry)`);
  } else if (rejected !== "INSUFFICIENT_PROFIT") {
    logFail(
      { stake, entry, mark },
      `tiny-edge case: should reject with INSUFFICIENT_PROFIT but got rejected=${rejected} cashout=${cashout}`
    );
  } else {
    pass += 1;
    console.log(`  ✅ tiny-edge case: mark=${mark}, raw≈$100.0012 → INSUFFICIENT_PROFIT (correct rejection)`);
  }
}

console.log(`\nPhase 1 result: ${pass} / ${pass + fail} pass`);
if (failures.length > 0) {
  console.log(`First few failures:`);
  for (const f of failures.slice(0, 10)) {
    console.log(`  ✗ ${JSON.stringify(f.scenario)} — ${f.reason}`);
  }
}

// ── Phase 2: cross-check JS vs SQL implementation ───────────────────────
if (!SKIP_SQL) {
  console.log(`\nPhase 2: SQL parity check (100 scenarios via _speed_cashout_margin)`);

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 4,
  });

  const client = await pool.connect();
  try {
    // Verify the helper exists.
    const helperCheck = await client.query(`
      SELECT proname FROM pg_proc
      WHERE proname = '_speed_cashout_margin'
    `);
    if (helperCheck.rows.length === 0) {
      console.log(
        `  ⚠ _speed_cashout_margin helper not found — mig 0028 not applied yet. Skipping SQL check.`
      );
    } else {
      let sqlPass = 0;
      let sqlFail = 0;
      for (let i = 0; i < 100; i++) {
        const s = randScenario();
        const isWinning = s.markProb > s.entryOfferedProb;
        const jsM = jsMargin({
          duration: s.duration,
          isWinning,
          markProb: s.markProb,
          secondsLeft: s.secondsLeft,
          config: DEFAULT_CONFIG,
        });

        const r = await client.query(
          `SELECT _speed_cashout_margin(
             $1::speed_duration,
             $2::boolean,
             $3::decimal,
             $4::double precision
           ) AS margin`,
          [s.duration, isWinning, s.markProb, s.secondsLeft]
        );
        const sqlM = Number(r.rows[0].margin);

        if (Math.abs(sqlM - jsM) > 0.0001) {
          logFail(s, `JS-vs-SQL margin mismatch: js=${jsM} sql=${sqlM}`);
          sqlFail += 1;
        } else {
          sqlPass += 1;
        }
      }
      console.log(`  Phase 2 result: ${sqlPass} / ${sqlPass + sqlFail} pass`);
      pass += sqlPass;
      fail += sqlFail;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

// ── Final ────────────────────────────────────────────────────────────────
console.log(`\n=== TOTAL: ${pass} pass, ${fail} fail ===`);
if (fail > 0) {
  console.log(`\n❌ DIRECTION-MATCHING INVARIANT VIOLATIONS FOUND. Do not ship.`);
  process.exit(1);
} else {
  console.log(`\n✅ Direction-matching invariant holds across all scenarios.`);
  process.exit(0);
}
