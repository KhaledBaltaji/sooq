// Inspect speed_oracle_latest + recent speed_oracle_ticks rows.
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const latest = await client.query("SELECT * FROM speed_oracle_latest ORDER BY received_at DESC");
console.log("speed_oracle_latest:");
console.table(latest.rows);

const ticks = await client.query(
  "SELECT asset, ts, price, source FROM speed_oracle_ticks ORDER BY ts DESC LIMIT 5"
);
console.log("\nspeed_oracle_ticks (last 5):");
console.table(ticks.rows);

const tickCount = await client.query("SELECT COUNT(*)::int AS n FROM speed_oracle_ticks");
console.log(`\ntotal ticks: ${tickCount.rows[0].n}`);

const markets = await client.query(
  "SELECT id, asset, duration, strike_price, opens_at, closes_at, status FROM speed_markets ORDER BY opens_at DESC LIMIT 5"
);
console.log("\nspeed_markets (most recent 5):");
console.table(markets.rows);

await client.end();
