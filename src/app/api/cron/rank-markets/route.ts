import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { sendSlackAlert } from "@/lib/slack";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  // Protect cron endpoint
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data, error } = await supabase.rpc("update_homepage_ranks");

    if (error) {
      logger.error("Failed to update homepage ranks", { error });
      await sendSlackAlert(["rank-markets cron failed", `RPC error: ${error.message}`]);
      return NextResponse.json({ error: "Failed to rank markets" }, { status: 500 });
    }

    logger.info("Homepage ranks updated", { ranked: data });
    return NextResponse.json({ ranked: data });
  } catch (err) {
    logger.error("rank-markets cron failed", { error: err });
    await sendSlackAlert(["rank-markets cron failed", `Error: ${err instanceof Error ? err.message : String(err)}`]);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
