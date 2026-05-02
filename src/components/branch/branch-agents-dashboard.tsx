"use client";

import { useState, useCallback, useEffect } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { AgentApprovalModal } from "./agent-approval-modal";
import { AgentRejectionModal } from "./agent-rejection-modal";
import { formatCurrency } from "@/lib/utils";
import { CheckCircle2, XCircle, Clock, Ban } from "lucide-react";

type AgentStatus = "pending" | "approved" | "rejected" | "suspended";
type FilterTab = "all" | "pending" | "approved" | "rejected";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface AgentRow extends Record<string, any> {
  id: string;
  user_id: string;
  status: AgentStatus;
  agent_type: "pl" | "commission" | null;
  rate: number | null;
  cumulative_pl: number;
  is_active: boolean;
  referral_code: string | null;
  parent_agent_id: string | null;
  created_at: string;
}

interface UserInfo {
  display_name: string | null;
  phone: string | null;
}

interface BranchAgentsDashboardProps {
  initialAgents: AgentRow[];
  initialUserMap: Record<string, UserInfo>;
  branchId: string;
}

const STATUS_CONFIG: Record<AgentStatus, { label: string; color: string; bgColor: string; icon: typeof Clock }> = {
  pending: { label: "Pending", color: "text-amber-700", bgColor: "bg-amber-100", icon: Clock },
  approved: { label: "Active", color: "text-emerald-700", bgColor: "bg-emerald-100", icon: CheckCircle2 },
  rejected: { label: "Rejected", color: "text-red-700", bgColor: "bg-red-100", icon: XCircle },
  suspended: { label: "Suspended", color: "text-[#566166]", bgColor: "bg-[#f0f4f7]", icon: Ban },
};

const TABS: { key: FilterTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Active" },
  { key: "rejected", label: "Rejected" },
];

export function BranchAgentsDashboard({ initialAgents, initialUserMap, branchId }: BranchAgentsDashboardProps) {
  const supabase = useSupabase();
  const [agents, setAgents] = useState<AgentRow[]>(initialAgents);
  const [userMap, setUserMap] = useState<Record<string, UserInfo>>(initialUserMap);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [approveAgent, setApproveAgent] = useState<AgentRow | null>(null);
  const [rejectAgent, setRejectAgent] = useState<AgentRow | null>(null);

  const shortId = (uid: string) => `#${uid.slice(0, 6).toUpperCase()}`;

  const getAgentName = (a: AgentRow) => {
    const u = userMap[a.user_id];
    return u?.display_name || u?.phone || shortId(a.user_id);
  };

  const refetchAgents = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("branch_agents")
      .select("*")
      .eq("branch_id", branchId)
      .order("created_at", { ascending: false });
    if (data) {
      setAgents(data);
      // Resolve any new user IDs
      const existingIds = new Set(Object.keys(userMap));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newIds = (data as AgentRow[]).map((a: AgentRow) => a.user_id).filter((id: string) => !existingIds.has(id));
      if (newIds.length > 0) {
        const { data: users } = await supabase.from("users").select("id, display_name, phone").in("id", newIds);
        if (users) {
          const updated = { ...userMap };
          for (const u of users) {
            updated[u.id] = { display_name: u.display_name, phone: u.phone };
          }
          setUserMap(updated);
        }
      }
    }
  }, [supabase, branchId, userMap]);

  // Realtime subscription for agent changes
  useEffect(() => {
    const channel = supabase
      .channel("branch-agents-dashboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "branch_agents", filter: `branch_id=eq.${branchId}` },
        () => { refetchAgents(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase, branchId, refetchAgents]);

  const filtered = filter === "all"
    ? agents
    : agents.filter((a) => a.status === filter);

  const pendingCount = agents.filter((a) => a.status === "pending").length;

  return (
    <>
      {/* Filter tabs */}
      <div className="flex gap-2 mb-8">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
              filter === tab.key
                ? "bg-[#2a3439] text-white"
                : "bg-[#f0f4f7] text-[#566166] hover:bg-[#e4e8eb]"
            }`}
          >
            {tab.label}
            {tab.key === "pending" && pendingCount > 0 && (
              <span className="ml-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Pending applications callout */}
      {pendingCount > 0 && filter !== "pending" && (
        <div className="mb-6 rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-amber-600" />
            <p className="text-sm font-semibold text-amber-800">
              {pendingCount} pending application{pendingCount > 1 ? "s" : ""} awaiting review
            </p>
          </div>
          <button
            onClick={() => setFilter("pending")}
            className="text-xs font-bold text-amber-700 hover:text-amber-900 uppercase tracking-wider"
          >
            View
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[#f0f4f7]">
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Agent</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Type</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Rate</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Cumulative P/L</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Status</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Referral Code</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#a9b4b9]/10">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-sm text-[#566166]">
                  {filter === "all" ? "No agents yet" : `No ${filter} agents`}
                </td>
              </tr>
            ) : (
              filtered.map((a) => {
                const statusCfg = STATUS_CONFIG[a.status];
                const StatusIcon = statusCfg.icon;
                return (
                  <tr key={a.id} className="hover:bg-[#f0f4f7]/50 transition-colors">
                    <td className="px-6 py-4 text-sm font-semibold text-[#2a3439]">
                      {getAgentName(a)}
                      {a.parent_agent_id && <span className="text-xs text-[#566166] ml-2">(sub-agent)</span>}
                    </td>
                    <td className="px-6 py-4">
                      {a.agent_type ? (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          a.agent_type === "pl" ? "bg-[#dae2fd] text-[#4a5167]" : "bg-emerald-100 text-emerald-800"
                        }`}>
                          {a.agent_type === "pl" ? "P/L" : "Commission"}
                        </span>
                      ) : (
                        <span className="text-xs text-[#566166]">---</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-[#2a3439]">
                      {a.rate != null ? `${(Number(a.rate) * 100).toFixed(1)}%` : "---"}
                    </td>
                    <td className="px-6 py-4 text-sm font-bold">
                      <span className={Number(a.cumulative_pl) >= 0 ? "text-emerald-600" : "text-red-600"}>
                        {Number(a.cumulative_pl) >= 0 ? "+" : ""}{formatCurrency(Number(a.cumulative_pl))}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${statusCfg.bgColor} ${statusCfg.color}`}>
                        <StatusIcon className="h-3 w-3" />
                        {statusCfg.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-[#566166]">{a.referral_code || "---"}</td>
                    <td className="px-6 py-4">
                      {a.status === "pending" && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => setApproveAgent(a)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => setRejectAgent(a)}
                            className="px-3 py-1.5 rounded-lg bg-red-100 text-red-700 text-xs font-semibold hover:bg-red-200 transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-[#566166]">{filtered.length} agent{filtered.length !== 1 ? "s" : ""} shown</p>

      {/* Modals */}
      {approveAgent && (
        <AgentApprovalModal
          agentId={approveAgent.id}
          agentName={getAgentName(approveAgent)}
          branchId={branchId}
          onClose={() => setApproveAgent(null)}
          onSuccess={() => {
            setApproveAgent(null);
            refetchAgents();
          }}
        />
      )}
      {rejectAgent && (
        <AgentRejectionModal
          agentId={rejectAgent.id}
          agentName={getAgentName(rejectAgent)}
          onClose={() => setRejectAgent(null)}
          onSuccess={() => {
            setRejectAgent(null);
            refetchAgents();
          }}
        />
      )}
    </>
  );
}
