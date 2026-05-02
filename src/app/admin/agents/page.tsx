import { createClient } from "@/lib/supabase/server";
import AgentsTable, { type AgentRow, type AgentsStats } from "./agents-table";

export default async function AdminAgentsPage() {
  const supabase = await createClient();

  // Parallel data fetching
  const [
    { data: referralAgents },
    { data: branchAgentRows },
    { data: branches },
    { data: commissions },
    { data: referredUsers },
    { data: branchUserAssignments },
  ] = await Promise.all([
    supabase
      .from("users")
      .select("id, display_name, phone, agent_level, direct_referral_count, network_volume")
      .gt("direct_referral_count", 0)
      .order("direct_referral_count", { ascending: false }),
    supabase
      .from("branch_agents")
      .select("id, branch_id, user_id, parent_agent_id, agent_type, rate, is_active, status, cumulative_pl"),
    supabase.from("branches").select("id, name"),
    supabase
      .from("referral_commissions")
      .select("referrer_id, layer, commission_amount")
      .eq("status", "credited"),
    supabase
      .from("users")
      .select("id, referred_by, direct_referral_count, display_name, phone, agent_level")
      .not("referred_by", "is", null),
    supabase.from("branch_user_assignments").select("agent_id"),
  ]);

  // Build lookup maps
  const branchMap = new Map<string, string>();
  (branches || []).forEach((b: any) => branchMap.set(b.id, b.name));

  // user_id → branch_name (from branch_agents)
  const userBranchMap = new Map<string, string>();
  const branchAgentByUserId = new Map<string, any>();
  (branchAgentRows || []).forEach((ba: any) => {
    const branchName = branchMap.get(ba.branch_id) || "Unknown";
    userBranchMap.set(ba.user_id, branchName);
    branchAgentByUserId.set(ba.user_id, ba);
  });

  // Commission totals per referrer
  const commissionMap = new Map<string, number>();
  (commissions || []).forEach((c: any) => {
    const existing = commissionMap.get(c.referrer_id) || 0;
    commissionMap.set(c.referrer_id, existing + Number(c.commission_amount));
  });

  // Referred users grouped by referred_by
  const referredByMap = new Map<string, any[]>();
  (referredUsers || []).forEach((u: any) => {
    if (!u.referred_by) return;
    const list = referredByMap.get(u.referred_by) || [];
    list.push(u);
    referredByMap.set(u.referred_by, list);
  });

  // Branch user assignments count per branch_agent.id
  const branchClientCount = new Map<string, number>();
  (branchUserAssignments || []).forEach((a: any) => {
    if (!a.agent_id) return;
    branchClientCount.set(a.agent_id, (branchClientCount.get(a.agent_id) || 0) + 1);
  });

  // Branch sub-agent count per parent_agent_id (branch_agents.id)
  const branchSubAgentMap = new Map<string, any[]>();
  (branchAgentRows || []).forEach((ba: any) => {
    if (!ba.parent_agent_id) return;
    const list = branchSubAgentMap.get(ba.parent_agent_id) || [];
    list.push(ba);
    branchSubAgentMap.set(ba.parent_agent_id, list);
  });

  // Set of all agent user IDs (from referral system)
  const agentUserIds = new Set((referralAgents || []).map((a: any) => a.id));

  // Build agent row from user data
  function buildAgentRow(user: any, depth: number): AgentRow {
    const branchName = userBranchMap.get(user.id) || "Main";
    const ba = branchAgentByUserId.get(user.id);
    const referralCommission = commissionMap.get(user.id) || 0;
    const branchPl = ba ? Math.max(0, Number(ba.cumulative_pl) || 0) : 0;

    // Sub-agents from referral system
    const referrals = referredByMap.get(user.id) || [];
    const subAgentReferrals = referrals.filter((r: any) => r.direct_referral_count > 0);
    const clientReferrals = referrals.length - subAgentReferrals.length;

    // Sub-agents from branch system
    let branchSubAgents: any[] = [];
    let branchClients = 0;
    if (ba) {
      branchSubAgents = branchSubAgentMap.get(ba.id) || [];
      branchClients = branchClientCount.get(ba.id) || 0;
    }

    // Build sub-agent rows (limit depth to 2)
    const subAgents: AgentRow[] = [];
    if (depth < 2) {
      // Referral sub-agents
      for (const sub of subAgentReferrals) {
        subAgents.push(buildAgentRow(sub, depth + 1));
      }
      // Branch sub-agents (if not already included via referral)
      const existingSubIds = new Set(subAgents.map((s) => s.id));
      for (const bsa of branchSubAgents) {
        if (!existingSubIds.has(bsa.user_id)) {
          // Find user data for this branch sub-agent
          const userData = (referredUsers || []).find((u: any) => u.id === bsa.user_id);
          if (userData) {
            subAgents.push(buildAgentRow(userData, depth + 1));
          }
        }
      }
    }

    return {
      id: user.id,
      display_name: user.display_name,
      phone: user.phone,
      agent_level: user.agent_level || 1,
      branch_name: branchName,
      client_count: clientReferrals + branchClients,
      sub_agent_count: subAgents.length,
      total_commission: referralCommission + branchPl,
      sub_agents: subAgents,
    };
  }

  // Build top-level agent rows — merge referral agents + branch-only agents
  const processedUserIds = new Set<string>();
  const topLevelAgents: AgentRow[] = [];

  // First: referral agents
  for (const agent of referralAgents || []) {
    topLevelAgents.push(buildAgentRow(agent, 0));
    processedUserIds.add(agent.id);
  }

  // Second: branch agents not already in referral system
  for (const ba of (branchAgentRows || []) as any[]) {
    if (processedUserIds.has(ba.user_id)) continue;
    if (ba.parent_agent_id) continue; // skip sub-agents, they appear under their parent
    // Find user data
    const userData = (referredUsers || []).find((u: any) => u.id === ba.user_id);
    const userInfo = userData || {
      id: ba.user_id,
      display_name: null,
      phone: null,
      agent_level: 1,
      direct_referral_count: 0,
    };
    topLevelAgents.push(buildAgentRow(userInfo, 0));
    processedUserIds.add(ba.user_id);
  }

  // Sort by client_count + sub_agent_count descending
  topLevelAgents.sort((a, b) => (b.client_count + b.sub_agent_count) - (a.client_count + a.sub_agent_count));

  // Compute stats
  const totalCommissions = topLevelAgents.reduce((s, r) => s + r.total_commission, 0);
  const mainAgents = topLevelAgents.filter((a) => a.branch_name === "Main").length;
  const branchAgentsCount = topLevelAgents.filter((a) => a.branch_name !== "Main").length;
  const topEarner = topLevelAgents.length > 0
    ? topLevelAgents.reduce((max, r) => (r.total_commission > max.total_commission ? r : max), topLevelAgents[0])
    : null;

  const stats: AgentsStats = {
    totalAgents: topLevelAgents.length,
    mainAgents,
    branchAgents: branchAgentsCount,
    totalCommissions,
    topEarner: topEarner
      ? { name: topEarner.display_name || topEarner.phone || "Anonymous", amount: topEarner.total_commission }
      : null,
  };

  return (
    <div className="p-8 space-y-8">
      <div>
        <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
          Agent Dashboard
        </h2>
        <p className="text-[#566166] mt-2 max-w-lg">
          Unified agent network — referral and branch agents with hierarchy.
        </p>
      </div>

      <AgentsTable agents={topLevelAgents} stats={stats} />
    </div>
  );
}
