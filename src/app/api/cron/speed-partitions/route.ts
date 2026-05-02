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

  const { data, error } = await supabase.rpc("speed_extend_partitions");

  if (error) {
    logger.error("speed-partitions cron failed", {
      source: "cron/speed-partitions",
      errorMessage: error.message,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logger.info(`speed-partitions: ensured ${data?.days_ensured ?? 0} days`, {
    source: "cron/speed-partitions",
  });

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    ...data,
  });
}
