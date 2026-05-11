#!/usr/bin/env node
/* eslint-disable no-console */
//
// test-iv-parity.mjs — invariant suite for mig 0056 + 0057.
//
// Asserts that get_speed_volatility (what the client API surface returns)
// always equals _speed_get_iv (what the trade RPC checks at execute time)
// per (asset, duration). Without this invariant, parity drift bugs
// resurface silently — exactly what bit us today.
//
// Also asserts mig 0056 added '1m' to _speed_get_iv's allowed-horizon list:
//   _speed_get_iv('BTC', '1m'::speed_duration) must NOT raise.
//
// Run: node --env-file=.env.local scripts/test-iv-parity.mjs
// Exit code: 0 = all pass; 1 = any failure.

import { Pool } from "pg";

const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete("sslmode");
const pool = new Pool({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: false },
});

let pass = 0;
let fail = 0;
const failures = [];

function ok(name) {
  console.log(`  ✓ ${name}`);
  pass++;
}
function bad(name, detail) {
  console.log(`  ✗ ${name}`);
  console.log(`      ${detail}`);
  fail++;
  failures.push({ name, detail });
}

const ASSETS = ["BTC", "GOLD"];
const DURATIONS = ["1m", "5m", "15m", "1h", "24h"];

async function main() {
  console.log("Pre-flight — confirm mig 0056 + 0057 are applied:");
  const probe = await pool.query(`
    SELECT
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
             WHERE p.proname = 'get_speed_volatility' AND n.nspname = 'public'
             AND pg_get_function_identity_arguments(p.oid) = 'p_asset text, p_duration speed_duration') AS has_2arg_overload,
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
             WHERE p.proname = 'get_speed_volatility' AND n.nspname = 'public'
             AND pg_get_function_identity_arguments(p.oid) = 'p_asset text') AS has_1arg_overload
  `);
  const { has_2arg_overload, has_1arg_overload } = probe.rows[0];
  if (!has_2arg_overload) {
    console.error("Pre-flight failed: get_speed_volatility(text, speed_duration) overload missing. Apply mig 0057 first.");
    process.exit(2);
  }
  if (!has_1arg_overload) {
    console.error("Pre-flight failed: get_speed_volatility(text) backward-compat overload missing. Apply mig 0057 first.");
    process.exit(2);
  }
  console.log("  ✓ both overloads present\n");

  // Group A — _speed_get_iv must accept all durations including 1m (mig 0056).
  console.log("Group A — _speed_get_iv accepts every duration (mig 0056 unblock):");
  for (const asset of ASSETS) {
    for (const dur of DURATIONS) {
      try {
        const r = await pool.query(
          `SELECT _speed_get_iv($1::text, $2::speed_duration) AS iv`,
          [asset, dur],
        );
        const iv = Number(r.rows[0].iv);
        if (!Number.isFinite(iv) || iv <= 0) {
          bad(`A: _speed_get_iv(${asset}, ${dur})`, `returned non-positive: ${iv}`);
        } else {
          ok(`A: _speed_get_iv(${asset}, ${dur}) = ${iv.toFixed(6)}`);
        }
      } catch (e) {
        bad(`A: _speed_get_iv(${asset}, ${dur})`, e.message);
      }
    }
  }

  // Group B — get_speed_volatility(asset, duration) returns the SAME iv as
  // _speed_get_iv. This is the load-bearing invariant for parity.
  console.log("\nGroup B — get_speed_volatility ≡ _speed_get_iv per (asset, duration):");
  for (const asset of ASSETS) {
    for (const dur of DURATIONS) {
      try {
        const r = await pool.query(
          `SELECT
             (get_speed_volatility($1::text, $2::speed_duration)->>'rv')::numeric AS api_rv,
             _speed_get_iv($1::text, $2::speed_duration) AS rpc_iv`,
          [asset, dur],
        );
        const apiRv = Number(r.rows[0].api_rv);
        const rpcIv = Number(r.rows[0].rpc_iv);
        if (Math.abs(apiRv - rpcIv) > 1e-9) {
          bad(
            `B: ${asset}/${dur} divergence`,
            `api=${apiRv}, rpc=${rpcIv}, diff=${(apiRv - rpcIv).toExponential()}`,
          );
        } else {
          ok(`B: ${asset}/${dur} agrees: ${apiRv.toFixed(6)}`);
        }
      } catch (e) {
        bad(`B: ${asset}/${dur}`, e.message);
      }
    }
  }

  // Group C — backward-compat: get_speed_volatility(asset) without duration
  // must default to 5m and equal the explicit 5m call.
  console.log("\nGroup C — backward-compat: 1-arg overload defaults to 5m:");
  for (const asset of ASSETS) {
    try {
      const r = await pool.query(
        `SELECT
           (get_speed_volatility($1::text)->>'rv')::numeric AS implicit_rv,
           (get_speed_volatility($1::text, '5m'::speed_duration)->>'rv')::numeric AS explicit_5m_rv`,
        [asset],
      );
      const a = Number(r.rows[0].implicit_rv);
      const b = Number(r.rows[0].explicit_5m_rv);
      if (Math.abs(a - b) > 1e-9) {
        bad(`C: ${asset} 1-arg vs 2-arg(5m)`, `implicit=${a}, explicit=${b}`);
      } else {
        ok(`C: ${asset} 1-arg (5m default) = ${a.toFixed(6)}`);
      }
    } catch (e) {
      bad(`C: ${asset}`, e.message);
    }
  }

  // Group D — the source field reports cache vs fallback honestly.
  console.log("\nGroup D — source field is one of {cache, fallback}:");
  for (const asset of ASSETS) {
    for (const dur of DURATIONS) {
      try {
        const r = await pool.query(
          `SELECT (get_speed_volatility($1::text, $2::speed_duration)->>'source') AS source`,
          [asset, dur],
        );
        const src = r.rows[0].source;
        if (src !== "cache" && src !== "fallback") {
          bad(`D: ${asset}/${dur} source`, `unexpected source value: ${src}`);
        } else {
          ok(`D: ${asset}/${dur} source = ${src}`);
        }
      } catch (e) {
        bad(`D: ${asset}/${dur}`, e.message);
      }
    }
  }

  console.log("\n──────────────────────────────────────────");
  console.log(`PASS: ${pass}   FAIL: ${fail}`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`);
  }
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  pool.end();
  process.exit(2);
});
