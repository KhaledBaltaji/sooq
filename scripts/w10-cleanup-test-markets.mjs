// W10 cleanup — void synthetic test markets injected by W9 suites.
//
// The cron-rolled markets always have opens_at exactly on a clean
// boundary (HH:MM:00 with MM % 5 = 0). Anything off-boundary is a
// suite-injected ephemeral market. Detect and void any that remain
// (status='open') so admin/health UIs don't see them.
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const r = await c.query(`
  SELECT id, duration, opens_at, closes_at, status,
    (SELECT COUNT(*)::int FROM speed_positions WHERE market_id = m.id) AS pos_count
  FROM speed_markets m
  WHERE (EXTRACT(SECOND FROM opens_at)::int <> 0 OR EXTRACT(MINUTE FROM opens_at)::int % 5 <> 0)
  ORDER BY opens_at DESC
`);

console.log("Off-boundary markets (test-injected):");
console.table(r.rows);

const stillOpen = r.rows.filter((row) => row.status === "open");
console.log(`\n${stillOpen.length} still open. Voiding…`);

for (const m of stillOpen) {
  await c.query(
    `UPDATE speed_markets
       SET status = 'voided',
           void_reason = 'W10 cleanup: synthetic test market from W9 suite',
           resolved_at = NOW()
     WHERE id = $1`,
    [m.id]
  );
  // Refund any positions on it
  const pos = await c.query(
    `UPDATE speed_positions SET status = 'refunded' WHERE market_id = $1 AND status = 'open' RETURNING id, user_id, stake`,
    [m.id]
  );
  console.log(
    `  ✓ voided ${m.duration} ${m.id} (refunded ${pos.rowCount} positions)`
  );
  // For each refunded position, credit the user (refunded means they get the stake back)
  for (const p of pos.rows) {
    await c.query(
      `UPDATE users SET balance_usd = balance_usd + $1, updated_at = NOW()
        WHERE id = $2`,
      [p.stake, p.user_id]
    );
    await c.query(
      `INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
       SELECT $1, 'speed_refund', $2,
         (SELECT balance_usd FROM users WHERE id = $1),
         NULL,
         'W10 cleanup: refund from voided synthetic test market'`,
      [p.user_id, p.stake]
    );
  }
}

await c.end();
console.log("\n✅ test-market cleanup done");
