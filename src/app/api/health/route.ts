import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { sendSlackAlert } from "@/lib/slack";

// Use service role — health checks run without user auth
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface CheckResult {
  status: "ok" | "error";
  latencyMs: number;
  error?: string;
}

async function runCheck(
  name: string,
  fn: () => Promise<void>
): Promise<CheckResult> {
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
  const [database, tables, auth, envVars] = await Promise.all([
    runCheck("database", async () => {
      const { error } = await supabase.from("users").select("id").limit(1);
      if (error) throw new Error(error.message);
    }),
    runCheck("tables", async () => {
      const { error: marketsErr } = await supabase
        .from("markets")
        .select("id")
        .limit(1);
      if (marketsErr) throw new Error(`markets: ${marketsErr.message}`);

      const { error: feeErr } = await supabase
        .from("fee_config")
        .select("fee_type")
        .limit(1);
      if (feeErr) throw new Error(`fee_config: ${feeErr.message}`);
    }),
    runCheck("auth", async () => {
      const { error } = await supabase.auth.getSession();
      if (error) throw new Error(error.message);
    }),
    runCheck("env_vars", async () => {
      const missing: string[] = [];
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
      if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
      if (missing.length > 0) throw new Error(`Missing: ${missing.join(", ")}`);
    }),
  ]);

  const checks = { database, tables, auth, envVars };
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

    await sendSlackAlert([
      "Health check DEGRADED",
      `Failed: ${failedChecks}`,
    ]);
  }

  return NextResponse.json(
    { status, timestamp: new Date().toISOString(), checks },
    { status: allOk ? 200 : 503 }
  );
}
