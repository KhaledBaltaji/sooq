// Drizzle DB client wired over node-postgres.
// Connection string comes from DATABASE_URL env var:
//   postgresql://sooqadmin:<password>@<rds-endpoint>:5432/sooq
//
// Master password lives in AWS Secrets Manager. Pull it once and write
// the resulting URL to .env.local locally; in Vercel set DATABASE_URL
// directly (or wire AWS Secrets Manager → Vercel Environment Variables
// via your secrets pipeline).
//
// Per-connection setup:
//   - The Auth.js Drizzle adapter handles its own queries.
//   - For application queries that need `app.user_id()`, we set the GUC
//     before the query via setUserContext() (W6 wiring lands later).

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const globalForPool = globalThis as unknown as { _pgPool?: Pool };

function makePool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Pull the RDS master password from " +
        "AWS Secrets Manager (`rds!db-fc910551-...`) and put the full " +
        "connection string in .env.local."
    );
  }
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    // Sane defaults for Vercel serverless; tune in W7.
    max: 10,
    idleTimeoutMillis: 30_000,
    ssl:
      process.env.NODE_ENV === "production" || process.env.DATABASE_URL.includes("rds.amazonaws.com")
        ? { rejectUnauthorized: false }
        : false,
  });
}

export const pool = globalForPool._pgPool ?? makePool();
if (process.env.NODE_ENV !== "production") globalForPool._pgPool = pool;

export const db = drizzle(pool, { schema });

export * as schema from "./schema";
