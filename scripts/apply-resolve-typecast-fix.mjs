// Apply 0021_resolve_type_cast_fix.sql to RDS staging.
//
// HOTFIX for the silent failure where speed_resolve_market raised
// "operator does not exist: speed_side = text" on every non-at_strike
// market with positions, leaving them stuck at status='open' indefinitely.
import { config } from "dotenv";
import { readFileSync } from "fs";
import pg from "pg";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

console.log("Pre-fix state:");
const stuckBefore = await c.query(
  `SELECT COUNT(*)::int AS n FROM speed_markets WHERE status='open' AND closes_at < NOW()`
);
console.log(`  stuck markets (open + past close): ${stuckBefore.rows[0].n}`);

const sql = readFileSync(
  new URL("../drizzle/migrations/0021_resolve_type_cast_fix.sql", import.meta.url),
  "utf-8"
);

console.log("\nApplying 0021_resolve_type_cast_fix.sql…");
await c.query(sql);
console.log("✅ migration applied");

console.log("\nManually invoking speed_resolve_expired_markets() to flush the backlog…");
const result = await c.query(`SELECT speed_resolve_expired_markets() AS r`);
console.log("Result:", JSON.stringify(result.rows[0].r, null, 2));

const stuckAfter = await c.query(
  `SELECT COUNT(*)::int AS n FROM speed_markets WHERE status='open' AND closes_at < NOW()`
);
console.log(`\nPost-fix state:\n  stuck markets (open + past close): ${stuckAfter.rows[0].n}`);

if (stuckAfter.rows[0].n === 0) {
  console.log("\n✅ all stuck markets resolved");
} else {
  console.log("\n⚠️  some markets still stuck — investigate");
}

await c.end();
