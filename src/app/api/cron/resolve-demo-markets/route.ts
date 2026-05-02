// Hourly cron: auto-resolve demo markets whose resolves_at has passed.
//
// Service-role client bypasses RLS so it can read demo_markets + call
// admin_resolve_demo_market (which itself reads the admin-only scheduled
// outcomes table via SECURITY DEFINER).
//
// Batch cap (LIMIT 100) prevents timeout on a backlog. Promise.allSettled
// ensures one failing market does not abort the batch.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

export const maxDuration = 300; // seconds — generous ceiling for backlog

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: due, error: queryError } = await supabase
    .from("demo_markets")
    .select("id, question_en")
    .eq("status", "open")
    .lte("resolves_at", new Date().toISOString())
    .order("resolves_at", { ascending: true })
    .limit(100);

  if (queryError) {
    logger.error("Failed to query due demo markets", {
      source: "cron/resolve-demo-markets",
      errorMessage: queryError.message,
    });
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  if (!due || due.length === 0) {
    return NextResponse.json({
      checked_at: new Date().toISOString(),
      resolved_count: 0,
      markets: [],
    });
  }

  const results = await Promise.allSettled(
    due.map((m) =>
      supabase
        .rpc("admin_resolve_demo_market", { p_market_id: m.id })
        .then((res) => {
          if (res.error) {
            throw new Error(`${m.id}: ${res.error.message}`);
          }
          return { id: m.id, question: m.question_en, result: res.data };
        })
    )
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected");

  if (failed.length > 0) {
    for (const f of failed) {
      if (f.status === "rejected") {
        logger.error("Demo market resolution failed", {
          source: "cron/resolve-demo-markets",
          errorMessage: (f.reason as Error)?.message ?? String(f.reason),
        });
      }
    }
  }

  logger.info(`Resolved ${succeeded} demo market(s), ${failed.length} failed`, {
    source: "cron/resolve-demo-markets",
    batch_size: due.length,
  });

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    resolved_count: succeeded,
    failed_count: failed.length,
    markets: results
      .filter((r): r is PromiseFulfilledResult<{ id: string; question: string; result: unknown }> => r.status === "fulfilled")
      .map((r) => ({ id: r.value.id, question: r.value.question })),
  });
}
