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

  const { data, error } = await supabase
    .from("markets")
    .update({ status: "closed" })
    .eq("status", "open")
    .lt("closes_at", new Date().toISOString())
    .select("id, question_en");

  if (error) {
    logger.error("Failed to close expired markets", {
      source: "cron/close-expired-markets",
      errorMessage: error.message,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const closed = data?.length ?? 0;
  if (closed > 0) {
    logger.info(`Auto-closed ${closed} expired market(s)`, {
      source: "cron/close-expired-markets",
      markets: data?.map((m) => m.question_en),
    });
  }

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    closed_count: closed,
    markets: data?.map((m) => ({ id: m.id, question: m.question_en })) ?? [],
  });
}
