// W11 cleanup — delete the test users and all their orphan rows from the
// W9 trade/load suites. These were created with direct UPDATE users SET
// balance_usd = X (bypassing the ledger), so they show up as drift in
// the reconciliation audit. They're staging-only test scaffolding; safe
// to delete entirely.

import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const TEST_EMAILS = ["w9-trade-suite@sooq.test", "w9-load-suite@sooq.test"];

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

await c.query("BEGIN");
try {
  const users = await c.query(
    "SELECT id, email FROM users WHERE email = ANY($1)",
    [TEST_EMAILS]
  );
  console.log(`Found ${users.rowCount} test users to wipe:`);
  console.table(users.rows);

  if (users.rowCount === 0) {
    console.log("Nothing to do.");
    await c.query("COMMIT");
    await c.end();
    process.exit(0);
  }

  const ids = users.rows.map((r) => r.id);

  // Delete from leaf tables first; FK cascades handle most of it but
  // being explicit keeps the audit log readable.
  const settlements = await c.query(
    "DELETE FROM speed_settlements WHERE user_id = ANY($1) RETURNING position_id",
    [ids]
  );
  console.log(`  speed_settlements: ${settlements.rowCount}`);

  const trades = await c.query(
    "DELETE FROM speed_trades WHERE user_id = ANY($1) RETURNING id",
    [ids]
  );
  console.log(`  speed_trades: ${trades.rowCount}`);

  const positions = await c.query(
    "DELETE FROM speed_positions WHERE user_id = ANY($1) RETURNING id",
    [ids]
  );
  console.log(`  speed_positions: ${positions.rowCount}`);

  const transactions = await c.query(
    "DELETE FROM transactions WHERE user_id = ANY($1) RETURNING id",
    [ids]
  );
  console.log(`  transactions: ${transactions.rowCount}`);

  const sessions = await c.query(
    `DELETE FROM sessions WHERE user_id = ANY($1) RETURNING session_token`,
    [ids]
  );
  console.log(`  sessions: ${sessions.rowCount}`);

  const accounts = await c.query(
    `DELETE FROM accounts WHERE user_id = ANY($1) RETURNING provider`,
    [ids]
  );
  console.log(`  accounts: ${accounts.rowCount}`);

  // Drop the user rows last
  const u = await c.query("DELETE FROM users WHERE id = ANY($1) RETURNING email", [ids]);
  console.log(`  users: ${u.rowCount}`);

  // Also clean any remaining synthetic markets that have no positions left
  const markets = await c.query(
    `DELETE FROM speed_markets m
     WHERE void_reason = 'W10 cleanup: synthetic test market from W9 suite'
       AND NOT EXISTS (SELECT 1 FROM speed_positions p WHERE p.market_id = m.id)
     RETURNING id`
  );
  console.log(`  speed_markets (synthetic, no positions): ${markets.rowCount}`);

  await c.query("COMMIT");
  console.log("\n✅ wipe complete");
} catch (err) {
  await c.query("ROLLBACK");
  console.error("❌ rolled back:", err.message);
  process.exit(1);
}

await c.end();
