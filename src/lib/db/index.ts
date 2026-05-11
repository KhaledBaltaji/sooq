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

  // Strip sslmode=... from the URL. pg-connection-string maps `require`,
  // `prefer`, and `verify-ca` to `verify-full` in current versions, which
  // forces cert-chain verification and rejects the AWS RDS chain on Node's
  // default trust store ("self-signed certificate in certificate chain").
  // We re-enable SSL via the explicit ssl option below where we control
  // rejectUnauthorized precisely.
  const rawUrl = process.env.DATABASE_URL;
  const url = rawUrl.replace(/([?&])sslmode=[^&]+(&|$)/i, (_match, prefix, suffix) =>
    suffix === "&" ? prefix : ""
  );
  const isRds = url.includes("rds.amazonaws.com");

  return new Pool({
    connectionString: url,
    // Pre-launch hardening Step 3 (2026-05-11): raised max 10 -> 20 per
    // function instance to ride through agent-network traffic bursts
    // without queueing. RDS db.t3.small has max_connections ~200; with
    // ~5 warm Lambda instances at peak that's 100 connections — well
    // inside headroom. runAs() uses db.transaction() which always
    // releases connections (commit + rollback both); no leak paths.
    max: 20,
    idleTimeoutMillis: 30_000,
    // 5-second connect cap so build-time SSG attempts fail fast when RDS
    // isn't reachable from the Vercel build pool, rather than hanging out
    // until Next's 60-second worker timeout kicks in.
    connectionTimeoutMillis: 5_000,
    // For RDS we encrypt the wire but skip cert-chain verification (no AWS
    // RDS root CA bundled in Node's trust store on Vercel). Acceptable for
    // staging; v2 wiring with RDS Proxy + IAM auth will tighten this.
    ssl:
      process.env.NODE_ENV === "production" || isRds
        ? { rejectUnauthorized: false }
        : false,
  });
}

export const pool = globalForPool._pgPool ?? makePool();
if (process.env.NODE_ENV !== "production") globalForPool._pgPool = pool;

export const db = drizzle(pool, { schema });

export * as schema from "./schema";
