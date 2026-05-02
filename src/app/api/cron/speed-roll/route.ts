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

  const { data, error } = await supabase.rpc("speed_roll_markets");

  if (error) {
    logger.error("speed-roll cron failed", {
      source: "cron/speed-roll",
      errorMessage: error.message,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if ((data?.created ?? 0) > 0) {
    logger.info(`speed-roll created ${data.created} market(s)`, {
      source: "cron/speed-roll",
      markets: data.markets,
    });
  }

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    ...data,
  });
}
