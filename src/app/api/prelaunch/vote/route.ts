import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { questionId, vote, visitorId } = body;

  if (!questionId || !vote || !visitorId) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  if (vote !== "yes" && vote !== "no") {
    return NextResponse.json({ error: "Vote must be yes or no" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("record_prelaunch_vote", {
    p_question_id: questionId,
    p_vote: vote,
    p_visitor_id: visitorId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = data?.[0];
  if (!row) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  return NextResponse.json({
    yesCount: row.yes_count,
    noCount: row.no_count,
    userVote: row.user_vote,
  });
}
