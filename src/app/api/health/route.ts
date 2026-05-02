import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendSlackAlert } from "@/lib/slack";

// W7 cutover: Drizzle/RDS-backed health check. Auth.js status is implicit
// in the DB check (sessions live in the same database).

interface CheckResult {
  status: "ok" | "error";
  latencyMs: number;
  error?: string;
}

async function runCheck(fn: () => Promise<void>): Promise<CheckResult> {
  const start = Date.now();
  try {
    await fn();
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET() {
  const [database, tables, cron, envVars] = await Promise.all([
    runCheck(async () => {
      const r = await db.execute<{ ok: number }>(sql`SELECT 1 AS ok`);
      if (r.rows[0]?.ok !== 1) throw new Error("SELECT 1 returned unexpected result");
    }),
    runCheck(async () => {
      // Probe core tables exist + are readable.
      await db.execute(sql`SELECT id FROM speed_markets LIMIT 1`);
      await db.execute(sql`SELECT fee_type FROM fee_config LIMIT 1`);
      await db.execute(sql`SELECT id FROM users LIMIT 1`);
    }),
    runCheck(async () => {
      const r = await db.execute<{ count: string }>(
        sql`SELECT COUNT(*)::text AS count FROM cron.job WHERE jobname LIKE 'speed-%'`
      );
      const count = parseInt(r.rows[0]?.count ?? "0", 10);
      if (count < 2) throw new Error(`expected 2 speed cron jobs, found ${count}`);
    }),
    runCheck(async () => {
      const missing: string[] = [];
      if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
      if (!process.env.AUTH_SECRET) missing.push("AUTH_SECRET");
      if (missing.length > 0) throw new Error(`Missing: ${missing.join(", ")}`);
    }),
  ]);

  const checks = { database, tables, cron, envVars };
  const allOk = Object.values(checks).every((c) => c.status === "ok");
  const status = allOk ? "healthy" : "degraded";

  if (!allOk) {
    const failedChecks = Object.entries(checks)
      .filter(([, v]) => v.status === "error")
      .map(([k, v]) => `${k}: ${v.error}`)
      .join("; ");

    logger.critical("Health check failed", {
      source: "api/health",
      failedChecks,
      checks,
    });

    await sendSlackAlert(["Health check DEGRADED", `Failed: ${failedChecks}`]);
  }

  return NextResponse.json(
    { status, timestamp: new Date().toISOString(), checks },
    { status: allOk ? 200 : 503 }
  );
}
