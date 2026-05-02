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

  const issues: string[] = [];

  // Check for unacknowledged critical/error system_logs in last 10 minutes
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recentErrors, error: logsError } = await supabase
    .from("system_logs")
    .select("id, severity, source, message")
    .eq("acknowledged", false)
    .in("severity", ["error", "critical"])
    .not("source", "in", "(webhook/3pay,webhook/whish,trade/execute)")
    .gte("created_at", tenMinutesAgo)
    .order("created_at", { ascending: false })
    .limit(20);

  if (logsError) {
    // system_logs table might not exist yet — that's ok
    logger.warn("Could not query system_logs", {
      source: "cron/check-errors",
      errorMessage: logsError.message,
    });
  } else if (recentErrors && recentErrors.length > 0) {
    issues.push(
      `${recentErrors.length} unacknowledged error(s): ${recentErrors
        .map((e) => `[${e.severity}] ${e.source}: ${e.message}`)
        .join("; ")}`
    );
  }

  // Check for balance mismatches (user portfolio cash)
  const { data: mismatches, error: reconcileError } = await supabase.rpc(
    "reconcile_balances"
  );

  if (reconcileError) {
    logger.warn("Could not run reconcile_balances", {
      source: "cron/check-errors",
      errorMessage: reconcileError.message,
    });
  } else if (mismatches && mismatches.length > 0) {
    issues.push(
      `${mismatches.length} balance mismatch(es) detected`
    );
  }

  // Check for agent wallet balance mismatches (commission balance)
  // The function exists since migration 143 with a >$0.001 threshold but
  // was never wired into any cron — agent wallet drift was undetected.
  const { data: agentMismatches, error: agentReconcileError } = await supabase.rpc(
    "reconcile_agent_balances"
  );

  if (agentReconcileError) {
    logger.warn("Could not run reconcile_agent_balances", {
      source: "cron/check-errors",
      errorMessage: agentReconcileError.message,
    });
  } else if (agentMismatches && agentMismatches.length > 0) {
    issues.push(
      `${agentMismatches.length} agent balance mismatch(es) detected`
    );
  }

  // Check for failed trades (webhook/trade errors in system_logs)
  const { data: tradeErrors } = await supabase
    .from("system_logs")
    .select("id, source, message, context")
    .eq("acknowledged", false)
    .in("severity", ["error", "critical"])
    .in("source", ["webhook/3pay", "webhook/whish", "trade/execute"])
    .gte("created_at", tenMinutesAgo)
    .limit(10);

  if (tradeErrors && tradeErrors.length > 0) {
    issues.push(
      `${tradeErrors.length} payment/trade failure(s): ${tradeErrors
        .map((e) => `[${e.source}] ${e.message}`)
        .join("; ")}`
    );
  }

  // --- Branch solvency reconciliation ---
  const { data: solvencyResults, error: solvencyError } = await supabase.rpc(
    "reconcile_branch_solvency"
  );

  if (solvencyError) {
    logger.warn("Could not run reconcile_branch_solvency", {
      source: "cron/check-errors",
      errorMessage: solvencyError.message,
    });
  } else if (solvencyResults && Array.isArray(solvencyResults)) {
    // reconcile_branch_solvency() returns rows with `difference` (worst-case
    // mismatch) and `pool_difference` (pool ledger mismatch) — NOT `discrepancy`.
    // The previous code filtered by a key that doesn't exist, so alerts never
    // fired (a $10K drift was silently auto-corrected during the W1-C audit).
    type SolvencyRow = {
      branch_id: string;
      branch_name?: string;
      difference: number;
      pool_difference: number;
    };
    const discrepancies = (solvencyResults as SolvencyRow[]).filter(
      (r) =>
        Math.abs(Number(r.difference)) > 10 ||
        Math.abs(Number(r.pool_difference)) > 10
    );
    if (discrepancies.length > 0) {
      issues.push(
        `${discrepancies.length} branch solvency discrepancy(ies) > $10: ${discrepancies
          .map((d) => {
            const wc = Math.abs(Number(d.difference));
            const pool = Math.abs(Number(d.pool_difference));
            const parts: string[] = [];
            if (wc > 10) parts.push(`worst-case $${d.difference}`);
            if (pool > 10) parts.push(`pool $${d.pool_difference}`);
            return `branch ${d.branch_name || d.branch_id} (${parts.join(", ")})`;
          })
          .join("; ")}`
      );
    }
  }

  // --- Branch payback escalation ---
  const { data: escalations, error: escalationError } = await supabase.rpc(
    "check_payback_escalation"
  );

  if (escalationError) {
    logger.warn("Could not run check_payback_escalation", {
      source: "cron/check-errors",
      errorMessage: escalationError.message,
    });
  } else if (escalations && Array.isArray(escalations) && escalations.length > 0) {
    issues.push(
      `${escalations.length} branch escalation(s): ${escalations
        .map((e: { branch_id: string; old_status: string; new_status: string }) =>
          `branch ${e.branch_id}: ${e.old_status} → ${e.new_status}`)
        .join("; ")}`
    );
  }

  // --- Branch velocity alerts ---
  const { data: velocityAlerts, error: velocityError } = await supabase.rpc(
    "check_branch_velocity"
  );

  if (velocityError) {
    logger.warn("Could not run check_branch_velocity", {
      source: "cron/check-errors",
      errorMessage: velocityError.message,
    });
  } else if (velocityAlerts && Array.isArray(velocityAlerts) && velocityAlerts.length > 0) {
    issues.push(
      `${velocityAlerts.length} branch velocity spike(s): ${(velocityAlerts as Array<{ branch_name: string; velocity_ratio: number; today_volume: number }>)
        .map((v) =>
          `${v.branch_name}: ${v.velocity_ratio}x avg ($${v.today_volume} today)`)
        .join("; ")}`
    );
  }

  // Alert if any issues found
  if (issues.length > 0) {
    logger.critical("Cron check found issues", {
      source: "cron/check-errors",
      issueCount: issues.length,
      issues,
    });

    // Send Slack alert if webhook URL is configured
    await sendSlackAlert(issues);
  }

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    issues_found: issues.length,
    issues,
  });
}

