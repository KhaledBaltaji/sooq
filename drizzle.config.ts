// Drizzle Kit config — Sooq.
// Schema is the source of truth in src/lib/db/schema.ts.
// Migrations are auto-generated into drizzle/migrations/ via:
//   npx drizzle-kit generate
//
// At W4 time we still apply hand-written SQL migrations under
// supabase/migrations/. The Drizzle migrations directory is wired up but
// unused until W7 service migration when we move off Supabase to RDS.

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/sooq",
  },
  verbose: true,
  strict: true,
});
