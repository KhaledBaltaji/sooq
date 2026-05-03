// Make khaledbaltaji@rival.finance a super-admin on RDS staging.
// Super-admin: is_admin = true, admin_allowed_views = NULL
// (per src/lib/admin-views.ts: NULL/empty allowed_views means access to
// everything; specific arrays would scope to those view keys).
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const TARGET_EMAIL = "khaledbaltaji@rival.finance";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const before = await c.query(
  "SELECT id, email, name, is_admin, admin_allowed_views, created_at FROM users WHERE email = $1",
  [TARGET_EMAIL]
);

if (before.rowCount === 0) {
  console.log(`❌ no user with email ${TARGET_EMAIL}`);
  console.log("   Sign in with Google first to create the user row, then re-run this.");
  await c.end();
  process.exit(1);
}

console.log("Before:");
console.table(before.rows);

const updated = await c.query(
  `UPDATE users
     SET is_admin = TRUE,
         admin_allowed_views = NULL,
         updated_at = NOW()
   WHERE email = $1
   RETURNING id, email, is_admin, admin_allowed_views`,
  [TARGET_EMAIL]
);

console.log("\nAfter:");
console.table(updated.rows);

console.log("\n✅ super-admin granted. Sign out + back in to refresh the session.");

await c.end();
