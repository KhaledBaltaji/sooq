import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { createClient } from "@supabase/supabase-js";
import { dispatchResolutionWebhooks } from "@/lib/branch-webhooks";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Admin-only API route to dispatch resolution webhooks to branches.
 * Called fire-and-forget from the resolve page after successful resolution.
 * Needs service role key to read branch webhook_secret from DB.
 */
export async function POST(request: NextRequest) {
  // Verify the caller is an authenticated admin
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.split(" ")[1];
  const supabase = getSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userData } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!userData?.is_admin) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }

  let body: { market_id?: string; outcome?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { market_id, outcome } = body;
  if (!market_id || !outcome) {
    return NextResponse.json({ error: "Missing market_id or outcome" }, { status: 400 });
  }

  // Dispatch webhooks in background — waitUntil keeps the function alive after response
  waitUntil(dispatchResolutionWebhooks(market_id, outcome).catch(() => {}));

  return NextResponse.json({ dispatched: true });
}
