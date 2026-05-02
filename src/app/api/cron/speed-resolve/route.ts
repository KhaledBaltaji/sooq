import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("speed_resolve_expired_markets");

  if (error) {
    logger.error("speed-resolve cron failed", {
      source: "cron/speed-resolve",
      errorMessage: error.message,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (data?.failed > 0) {
    logger.warn(`speed-resolve had ${data.failed} failure(s)`, {
      source: "cron/speed-resolve",
      errors: data.errors,
    });
  }

  if ((data?.resolved ?? 0) > 0 || (data?.voided ?? 0) > 0) {
    logger.info(
      `speed-resolve: ${data.resolved} resolved, ${data.voided} voided`,
      { source: "cron/speed-resolve" }
    );
  }

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    ...data,
  });
}
