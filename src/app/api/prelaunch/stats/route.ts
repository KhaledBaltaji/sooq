import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const [votesResult, waitlistResult, questionsResult] = await Promise.all([
    supabase
      .from("prelaunch_votes")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("prelaunch_waitlist")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("prelaunch_questions")
      .select("slug, yes_count, no_count")
      .eq("active", true)
      .order("sort_order"),
  ]);

  const questions = (questionsResult.data || []).map((q) => {
    const total = q.yes_count + q.no_count;
    return {
      slug: q.slug,
      yesPercent: total > 0 ? Math.round((q.yes_count / total) * 100) : 50,
      noPercent: total > 0 ? Math.round((q.no_count / total) * 100) : 50,
      totalVotes: total,
    };
  });

  return NextResponse.json({
    totalVotes: votesResult.count || 0,
    waitlistSize: waitlistResult.count || 0,
    questions,
  });
}
