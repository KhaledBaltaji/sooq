"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { redirect } from "next/navigation";

/**
 * Referral attribution resolver — typed dispatch across signup surfaces.
 *
 * Signup can arrive via three surfaces:
 *   1. /r/[code]                          → direct referral code
 *   2. /b/[slug]                          → branch signup (no sub-agent)
 *   3. /b/[slug]/?agent=[sub_code]        → branch signup via sub-agent
 *
 * Each surface resolves to one of four attribution paths:
 *
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │ AttributionPath                                                 │
 *   ├────────────────────────────┬────────────────────────────────────┤
 *   │ retail_user                │ code matched users.referral_code   │
 *   │                            │ → write users.referred_by          │
 *   ├────────────────────────────┼────────────────────────────────────┤
 *   │ branch_agent_reseller      │ code matched branch_agents on a    │
 *   │                            │ reseller branch                    │
 *   │                            │ → write branch_user_assignments    │
 *   ├────────────────────────────┼────────────────────────────────────┤
 *   │ branch_agent_commission    │ code matched branch_agents on a    │
 *   │                            │ commission branch                  │
 *   │                            │ → write users.referred_by          │
 *   │                            │ + users.signup_branch_id           │
 *   ├────────────────────────────┼────────────────────────────────────┤
 *   │ branch_manager_commission  │ /b/[slug] signup on a commission   │
 *   │                            │ branch with no ?agent=             │
 *   │                            │ → write users.referred_by          │
 *   │                            │ (manager) + users.signup_branch_id │
 *   └────────────────────────────┴────────────────────────────────────┘
 *
 * Iron rules:
 *   - First-touch attribution: if users.referred_by is already set,
 *     NEVER rewrite it. The signup_branch_id also stays unset to keep
 *     attribution internally consistent.
 *   - Cross-branch rejection: if /b/alice-sports/?agent=[charlie_code]
 *     and Charlie belongs to beirut-bets, reject with BRANCH_SCOPE_MISMATCH.
 *     No silent fallthrough.
 *   - Non-fatal on failure: signup completes even if attribution fails.
 *     All failures logged with enough context to reconcile later.
 */

export type ReferralKind =
  | "none"
  | "retail_user"
  | "branch_agent_reseller"
  | "branch_agent_commission"
  | "branch_manager_commission";

export interface ReferralResult {
  ok: boolean;
  kind: ReferralKind;
  error?: string;
}

export type ResolverInput =
  | { type: "direct_code"; code: string }
  | { type: "branch_signup"; branchSlug: string; agentCode?: string };

const SERVICE_SOURCE = "auth/resolveAndApplyReferral";

type BranchRow = {
  id: string;
  branch_code: string;
  book_type: "reseller" | "commission" | "bookmaker";
  manager_user_id: string;
  status: string;
};

type BranchAgentRow = {
  id: string;
  branch_id: string;
  user_id: string;
  is_active: boolean;
  status: string;
};

type AttributionPath =
  | {
      kind: "retail_user";
      referrerId: string;
    }
  | {
      kind: "branch_agent_reseller";
      agentId: string;
      branchId: string;
    }
  | {
      kind: "branch_agent_commission";
      referrerId: string;
      branchId: string;
    }
  | {
      kind: "branch_manager_commission";
      referrerId: string;
      branchId: string;
    };

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Resolve a referral code against both systems and apply attribution.
 *
 * Accepts either a legacy string (direct code) or a structured ResolverInput.
 * Backward-compatible with existing `/r/[code]` callers.
 */
export async function resolveAndApplyReferral(
  userId: string,
  input: ResolverInput | string
): Promise<ReferralResult> {
  const resolverInput: ResolverInput =
    typeof input === "string" ? { type: "direct_code", code: input } : input;

  if (resolverInput.type === "direct_code" && !resolverInput.code) {
    return { ok: false, kind: "none", error: "EMPTY_CODE" };
  }
  if (resolverInput.type === "branch_signup" && !resolverInput.branchSlug) {
    return { ok: false, kind: "none", error: "EMPTY_BRANCH_SLUG" };
  }

  const path = await resolvePath(userId, resolverInput);
  if (!("kind" in path)) {
    return { ok: false, kind: "none", error: path.error };
  }

  return applyPath(userId, path);
}

async function resolvePath(
  userId: string,
  input: ResolverInput
): Promise<AttributionPath | { error: string }> {
  const serviceClient = getServiceClient();

  if (input.type === "direct_code") {
    return resolveDirectCode(userId, input.code, serviceClient);
  }

  return resolveBranchSignup(userId, input.branchSlug, input.agentCode, serviceClient);
}

async function resolveDirectCode(
  userId: string,
  code: string,
  serviceClient: ReturnType<typeof getServiceClient>
): Promise<AttributionPath | { error: string }> {
  // Path 1: branch_agents.referral_code — need to discriminate on branch.book_type
  const { data: branchAgent, error: branchLookupError } = await serviceClient
    .from("branch_agents")
    .select("id, branch_id, user_id, is_active, status")
    .eq("referral_code", code)
    .maybeSingle<BranchAgentRow>();

  if (branchLookupError) {
    logger.warn("Branch-agent referral lookup failed", {
      source: SERVICE_SOURCE,
      userId,
      code,
      errorMessage: branchLookupError.message,
    });
  }

  if (branchAgent && branchAgent.is_active && branchAgent.status === "approved") {
    const branch = await loadBranchById(serviceClient, branchAgent.branch_id);
    if (!branch) {
      logger.warn("Branch-agent points to missing branch; falling through", {
        source: SERVICE_SOURCE,
        userId,
        code,
        branchId: branchAgent.branch_id,
      });
    } else if (branch.book_type === "commission") {
      return {
        kind: "branch_agent_commission",
        referrerId: branchAgent.user_id,
        branchId: branch.id,
      };
    } else {
      return {
        kind: "branch_agent_reseller",
        agentId: branchAgent.id,
        branchId: branch.id,
      };
    }
  }

  // Path 2: users.referral_code (retail network)
  const { data: referrer, error: userLookupError } = await serviceClient
    .from("users")
    .select("id, referred_by, referral_chain")
    .eq("referral_code", code)
    .maybeSingle();

  if (userLookupError) {
    logger.warn("Retail referral lookup failed", {
      source: SERVICE_SOURCE,
      userId,
      code,
      errorMessage: userLookupError.message,
    });
    return { error: "LOOKUP_FAILED" };
  }

  if (!referrer) {
    logger.warn("Referral code did not match any user or branch agent", {
      source: SERVICE_SOURCE,
      userId,
      code,
    });
    return { error: "INVALID_CODE" };
  }

  if (referrer.id === userId) {
    logger.warn("Referral code points to self", {
      source: SERVICE_SOURCE,
      userId,
      code,
    });
    return { error: "SELF_REFERRAL" };
  }

  const isCircular =
    referrer.referred_by === userId ||
    (Array.isArray(referrer.referral_chain) &&
      referrer.referral_chain.includes(userId));

  if (isCircular) {
    logger.warn("Referral would create circular chain; skipping", {
      source: SERVICE_SOURCE,
      userId,
      code,
      referrerId: referrer.id,
    });
    return { error: "CIRCULAR" };
  }

  return { kind: "retail_user", referrerId: referrer.id };
}

async function resolveBranchSignup(
  userId: string,
  branchSlug: string,
  agentCode: string | undefined,
  serviceClient: ReturnType<typeof getServiceClient>
): Promise<AttributionPath | { error: string }> {
  const branch = await loadBranchBySlug(serviceClient, branchSlug);
  if (!branch) {
    logger.warn("Branch slug did not match any branch", {
      source: SERVICE_SOURCE,
      userId,
      branchSlug,
    });
    return { error: "INVALID_BRANCH_SLUG" };
  }

  // Commission branches: attribution via referred_by + signup_branch_id.
  // Reseller (and any future pool-based) branches: delegate to existing
  // branch_user_assignments path only when we actually have a sub-agent.
  // A bare /b/[reseller-slug] signup with no ?agent= is not a resolved
  // referral — the user is just browsing. Return invalid so signup proceeds
  // without attribution.
  if (branch.book_type !== "commission") {
    if (!agentCode) {
      return { error: "NON_COMMISSION_BRANCH_BARE_SIGNUP" };
    }
    // Fall through to sub-agent resolution, but scope-check against this branch
  }

  if (agentCode) {
    const { data: branchAgent, error: agentLookupError } = await serviceClient
      .from("branch_agents")
      .select("id, branch_id, user_id, is_active, status")
      .eq("referral_code", agentCode)
      .maybeSingle<BranchAgentRow>();

    if (agentLookupError) {
      logger.warn("Branch-agent lookup failed in branch signup", {
        source: SERVICE_SOURCE,
        userId,
        branchSlug,
        agentCode,
        errorMessage: agentLookupError.message,
      });
      return { error: "LOOKUP_FAILED" };
    }

    if (!branchAgent) {
      logger.warn("Sub-agent code did not match any branch agent", {
        source: SERVICE_SOURCE,
        userId,
        branchSlug,
        agentCode,
      });
      return { error: "INVALID_AGENT_CODE" };
    }

    // Cross-branch rejection (eng-review decision): sub-agent must belong to URL's branch
    if (branchAgent.branch_id !== branch.id) {
      logger.warn("Cross-branch sub-agent rejected", {
        source: SERVICE_SOURCE,
        userId,
        branchSlug,
        branchId: branch.id,
        agentBranchId: branchAgent.branch_id,
        agentCode,
      });
      return { error: "BRANCH_SCOPE_MISMATCH" };
    }

    if (!branchAgent.is_active || branchAgent.status !== "approved") {
      logger.info("Inactive/unapproved sub-agent; falling through to branch manager", {
        source: SERVICE_SOURCE,
        userId,
        branchSlug,
        agentCode,
        agentStatus: branchAgent.status,
        agentActive: branchAgent.is_active,
      });
      // Fallthrough to manager attribution (commission branch only — reseller has returned already)
      if (branch.book_type === "commission") {
        return {
          kind: "branch_manager_commission",
          referrerId: branch.manager_user_id,
          branchId: branch.id,
        };
      }
      return { error: "INACTIVE_AGENT_ON_RESELLER_BRANCH" };
    }

    // Active sub-agent on a matching commission branch
    if (branch.book_type === "commission") {
      return {
        kind: "branch_agent_commission",
        referrerId: branchAgent.user_id,
        branchId: branch.id,
      };
    }

    // Active sub-agent on a reseller branch — existing branch_user_assignments path
    return {
      kind: "branch_agent_reseller",
      agentId: branchAgent.id,
      branchId: branch.id,
    };
  }

  // No agentCode + commission branch → attribute to branch manager
  return {
    kind: "branch_manager_commission",
    referrerId: branch.manager_user_id,
    branchId: branch.id,
  };
}

async function applyPath(
  userId: string,
  path: AttributionPath
): Promise<ReferralResult> {
  const serviceClient = getServiceClient();

  // First-touch guard: if this user already has referred_by set, don't rewrite.
  // Also used to decide whether to set signup_branch_id (we don't, to keep
  // attribution internally consistent with referred_by).
  if (
    path.kind === "retail_user" ||
    path.kind === "branch_agent_commission" ||
    path.kind === "branch_manager_commission"
  ) {
    const { data: currentUser, error: loadError } = await serviceClient
      .from("users")
      .select("id, referred_by")
      .eq("id", userId)
      .maybeSingle();

    if (loadError) {
      logger.error("Failed to load user for first-touch check", {
        source: SERVICE_SOURCE,
        userId,
        pathKind: path.kind,
        errorMessage: loadError.message,
      });
      return { ok: false, kind: "none", error: "USER_LOAD_FAILED" };
    }

    if (currentUser?.referred_by) {
      logger.info("First-touch attribution wins; skipping rewrite", {
        source: SERVICE_SOURCE,
        userId,
        existingReferrer: currentUser.referred_by,
        skippedPath: path.kind,
      });
      return { ok: true, kind: path.kind };
    }
  }

  switch (path.kind) {
    case "retail_user": {
      const { error: updateError } = await serviceClient
        .from("users")
        .update({ referred_by: path.referrerId })
        .eq("id", userId);

      if (updateError) {
        logger.error("Failed to write referred_by on signup", {
          source: SERVICE_SOURCE,
          userId,
          referrerId: path.referrerId,
          errorMessage: updateError.message,
        });
        return { ok: false, kind: path.kind, error: "UPDATE_FAILED" };
      }
      return { ok: true, kind: path.kind };
    }

    case "branch_agent_reseller": {
      const { error: assignmentError } = await serviceClient
        .from("branch_user_assignments")
        .insert({
          user_id: userId,
          branch_id: path.branchId,
          agent_id: path.agentId,
        });

      if (assignmentError) {
        logger.warn("Branch user assignment failed", {
          source: SERVICE_SOURCE,
          userId,
          agentId: path.agentId,
          branchId: path.branchId,
          errorMessage: assignmentError.message,
        });
        return { ok: false, kind: path.kind, error: "ASSIGNMENT_FAILED" };
      }
      return { ok: true, kind: path.kind };
    }

    case "branch_agent_commission":
    case "branch_manager_commission": {
      const { error: updateError } = await serviceClient
        .from("users")
        .update({
          referred_by: path.referrerId,
          signup_branch_id: path.branchId,
        })
        .eq("id", userId);

      if (updateError) {
        logger.error("Failed to write commission-branch attribution", {
          source: SERVICE_SOURCE,
          userId,
          referrerId: path.referrerId,
          branchId: path.branchId,
          pathKind: path.kind,
          errorMessage: updateError.message,
        });
        return { ok: false, kind: path.kind, error: "UPDATE_FAILED" };
      }
      return { ok: true, kind: path.kind };
    }
  }
}

async function loadBranchById(
  serviceClient: ReturnType<typeof getServiceClient>,
  branchId: string
): Promise<BranchRow | null> {
  const { data, error } = await serviceClient
    .from("branches")
    .select("id, branch_code, book_type, manager_user_id, status")
    .eq("id", branchId)
    .maybeSingle<BranchRow>();

  if (error) {
    logger.warn("Branch lookup by id failed", {
      source: SERVICE_SOURCE,
      branchId,
      errorMessage: error.message,
    });
    return null;
  }
  return data ?? null;
}

async function loadBranchBySlug(
  serviceClient: ReturnType<typeof getServiceClient>,
  slug: string
): Promise<BranchRow | null> {
  const { data, error } = await serviceClient
    .from("branches")
    .select("id, branch_code, book_type, manager_user_id, status")
    .eq("branch_code", slug)
    .maybeSingle<BranchRow>();

  if (error) {
    logger.warn("Branch lookup by slug failed", {
      source: SERVICE_SOURCE,
      slug,
      errorMessage: error.message,
    });
    return null;
  }
  return data ?? null;
}

export async function signOut() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Sign out failed:", error.message);
  }
  redirect("/login");
}
