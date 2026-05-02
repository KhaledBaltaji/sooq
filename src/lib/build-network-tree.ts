import type { AgentNetworkFlat, AgentNetworkNode } from "@/types/agent";

export function buildNetworkTree(flat: AgentNetworkFlat): AgentNetworkNode[] {
  const { l1_users, l2_users, commissions } = flat;

  // Group L2 users by their referred_by (parent L1 id)
  const l2ByParent = new Map<string, AgentNetworkNode[]>();
  for (const u of l2_users) {
    const node: AgentNetworkNode = {
      id: u.id,
      display_name: u.display_name,
      layer: 2,
      agent_level: u.agent_level,
      referral_count: u.referral_count,
      commission_earned: commissions[u.id]?.commission_earned ?? 0,
      revenue_generated: commissions[u.id]?.revenue_generated ?? 0,
      trade_count: commissions[u.id]?.trade_count ?? 0,
      children: [],
    };
    const existing = l2ByParent.get(u.referred_by);
    if (existing) {
      existing.push(node);
    } else {
      l2ByParent.set(u.referred_by, [node]);
    }
  }

  // Build L1 nodes with L2 children attached
  return l1_users.map((u) => ({
    id: u.id,
    display_name: u.display_name,
    layer: 1 as const,
    agent_level: u.agent_level,
    referral_count: u.referral_count,
    commission_earned: commissions[u.id]?.commission_earned ?? 0,
    revenue_generated: commissions[u.id]?.revenue_generated ?? 0,
    trade_count: commissions[u.id]?.trade_count ?? 0,
    children: l2ByParent.get(u.id) ?? [],
  }));
}
