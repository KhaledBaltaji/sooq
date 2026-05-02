/**
 * Branch resolution webhook dispatch.
 * After resolve_market succeeds, POST signed notifications to each branch
 * that had active positions on the resolved market.
 *
 * Fire-and-forget pattern — never crashes the caller.
 */

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface ResolutionWebhookPayload {
  event: "market.resolved";
  market_id: string;
  outcome: string;
  resolution_timestamp: string;
  delivery_id: string;
}

function signPayload(payload: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Dispatch resolution webhooks to all branches that had trades on this market.
 * - Queries branch_trades joined to branches for webhook_url IS NOT NULL
 * - HMAC-SHA256 signs each payload with the branch's webhook_secret
 * - Promise.allSettled: one branch failure doesn't block others
 * - Logs each result to system_logs
 */
export async function dispatchResolutionWebhooks(
  marketId: string,
  outcome: string
): Promise<void> {
  try {
    const supabase = getSupabase();

    // Find distinct branches with webhook_url set that had trades on this market
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows, error } = await (supabase as any)
      .from("branch_trades")
      .select("branch_id")
      .eq("market_id", marketId) as { data: Array<{ branch_id: string }> | null; error: unknown };

    if (error || !rows || rows.length === 0) return;

    // Deduplicate branch IDs
    const branchIds = [...new Set(rows.map((r) => r.branch_id))];

    // Fetch branch webhook configs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: branches, error: branchErr } = await (supabase as any)
      .from("branches")
      .select("id, name, webhook_url, webhook_secret")
      .in("id", branchIds)
      .not("webhook_url", "is", null) as {
        data: Array<{ id: string; name: string; webhook_url: string; webhook_secret: string | null }> | null;
        error: unknown;
      };

    if (branchErr || !branches || branches.length === 0) return;

    const payload: ResolutionWebhookPayload = {
      event: "market.resolved",
      market_id: marketId,
      outcome,
      resolution_timestamp: new Date().toISOString(),
      delivery_id: crypto.randomUUID(),
    };
    const body = JSON.stringify(payload);

    const results = await Promise.allSettled(
      branches.map(async (branch) => {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (branch.webhook_secret) {
          headers["X-Webhook-Signature"] = signPayload(body, branch.webhook_secret);
        }

        const response = await fetch(branch.webhook_url, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(10_000), // 10s timeout
        });

        return { branchId: branch.id, branchName: branch.name, status: response.status };
      })
    );

    // Log results to system_logs (fire-and-forget)
    for (const result of results) {
      if (result.status === "fulfilled") {
        const { branchId, branchName, status } = result.value;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        void (supabase as any).from("system_logs").insert({
          severity: status >= 200 && status < 300 ? "info" : "warn",
          source: "webhook/branch-resolution",
          message: `Resolution webhook to ${branchName}: HTTP ${status}`,
          context: { branch_id: branchId, market_id: marketId, outcome, http_status: status },
        });
      } else {
        const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        void (supabase as any).from("system_logs").insert({
          severity: "warn",
          source: "webhook/branch-resolution",
          message: `Resolution webhook failed: ${errorMsg}`,
          context: { market_id: marketId, outcome, error: errorMsg },
        });
      }
    }
  } catch (err) {
    // Never let webhook dispatch crash the caller
    logger.warn("dispatchResolutionWebhooks failed", {
      source: "webhook/branch-resolution",
      marketId,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}
