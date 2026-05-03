// Trace the 25 settled-positions-without-settlement-rows.
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
  SELECT p.status,
         u.email,
         m.status AS market_status,
         m.void_reason,
         p.payout_amount,
         p.created_at::text AS created_at
  FROM speed_positions p
  LEFT JOIN users u ON u.id = p.user_id
  LEFT JOIN speed_markets m ON m.id = p.market_id
  WHERE p.status IN ('won','lost','refunded')
    AND NOT EXISTS (SELECT 1 FROM speed_settlements s WHERE s.position_id = p.id)
  ORDER BY p.created_at DESC
`);
console.log(`${r.rowCount} orphan settled positions:`);
console.table(r.rows);

const groupBy = await c.query(`
  SELECT u.email,
         m.status AS market_status,
         p.status AS position_status,
         m.void_reason,
         count(*)::int AS n
  FROM speed_positions p
  LEFT JOIN users u ON u.id = p.user_id
  LEFT JOIN speed_markets m ON m.id = p.market_id
  WHERE p.status IN ('won','lost','refunded')
    AND NOT EXISTS (SELECT 1 FROM speed_settlements s WHERE s.position_id = p.id)
  GROUP BY u.email, m.status, p.status, m.void_reason
  ORDER BY n DESC
`);
console.log("\nGrouped:");
console.table(groupBy.rows);

await c.end();
