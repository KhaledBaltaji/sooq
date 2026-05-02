"use client";

import { useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";

const LEVEL_STYLES: Record<number, { bg: string; text: string }> = {
  1: { bg: "bg-[#e8eff3]", text: "text-[#566166]" },
  2: { bg: "bg-[var(--yes)]/10", text: "text-[var(--yes)]" },
  3: { bg: "bg-[var(--warning)]/10", text: "text-[var(--warning)]" },
  4: { bg: "bg-emerald-50", text: "text-emerald-600" },
};

export interface AgentRow {
  id: string;
  display_name: string | null;
  phone: string | null;
  agent_level: number;
  branch_name: string;
  client_count: number;
  sub_agent_count: number;
  total_commission: number;
  sub_agents: AgentRow[];
}

export interface AgentsStats {
  totalAgents: number;
  mainAgents: number;
  branchAgents: number;
  totalCommissions: number;
  topEarner: { name: string; amount: number } | null;
}

interface AgentsTableProps {
  agents: AgentRow[];
  stats: AgentsStats;
}

function AgentRowComponent({
  row,
  depth,
  expandedIds,
  toggleExpand,
  rowIndex,
}: {
  row: AgentRow;
  depth: number;
  expandedIds: Set<string>;
  toggleExpand: (id: string) => void;
  rowIndex: number;
}) {
  const isExpanded = expandedIds.has(row.id);
  const hasSubAgents = row.sub_agents.length > 0;
  const level = LEVEL_STYLES[row.agent_level] || LEVEL_STYLES[1];
  const isNested = depth > 0;

  return (
    <>
      <tr
        className={`hover:bg-[#f0f4f7]/50 transition-colors cursor-pointer ${
          isNested ? "bg-[#f8faf9]" : rowIndex % 2 === 1 ? "bg-[#f0f4f7]/20" : ""
        }`}
        onClick={() => hasSubAgents && toggleExpand(row.id)}
      >
        <td className="px-3 py-5 w-10">
          {hasSubAgents ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(row.id);
              }}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#e8eff3] transition-colors"
            >
              <span className="material-symbols-outlined text-[#566166] text-base transition-transform duration-200" style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>
                chevron_right
              </span>
            </button>
          ) : (
            <span className="w-6 inline-block" />
          )}
        </td>
        <td className="px-4 py-5" style={{ paddingLeft: depth > 0 ? `${depth * 24 + 16}px` : undefined }}>
          {isNested && (
            <span className="inline-block w-4 h-px bg-emerald-300 mr-2 align-middle" />
          )}
          <Link
            href={`/admin/users/${row.id}`}
            className="text-sm font-semibold text-[#2a3439] hover:text-[var(--yes)] transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {row.display_name || row.phone || "—"}
          </Link>
        </td>
        <td className="px-4 py-5">
          <span
            className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase ${
              row.branch_name === "Main"
                ? "bg-[#e8eff3] text-[#566166]"
                : "bg-[#dae2fd] text-[#4a5167]"
            }`}
          >
            {row.branch_name}
          </span>
        </td>
        <td className="px-4 py-5">
          <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase ${level.bg} ${level.text}`}>
            L{row.agent_level}
          </span>
        </td>
        <td className="px-4 py-5 text-right text-sm font-medium text-[#2a3439] tabular-nums">
          {row.client_count}
        </td>
        <td className="px-4 py-5 text-right text-sm font-medium text-[#2a3439] tabular-nums">
          {row.sub_agent_count > 0 ? (
            <span className="text-emerald-600">{row.sub_agent_count}</span>
          ) : (
            <span className="text-[#a9b4b9]">0</span>
          )}
        </td>
        <td className="px-4 py-5 text-right text-sm font-bold text-[#2a3439] tabular-nums">
          {formatCurrency(row.total_commission)}
        </td>
      </tr>
      {isExpanded &&
        row.sub_agents.map((sub, i) => (
          <AgentRowComponent
            key={sub.id}
            row={sub}
            depth={Math.min(depth + 1, 2)}
            expandedIds={expandedIds}
            toggleExpand={toggleExpand}
            rowIndex={i}
          />
        ))}
    </>
  );
}

export default function AgentsTable({ agents, stats }: AgentsTableProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-8">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-[#dae2fd] rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-[#4a5167] text-lg">group</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Total Agents</span>
          </div>
          <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] text-[#2a3439]">{stats.totalAgents}</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-emerald-600 text-lg">home</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Main Agents</span>
          </div>
          <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] text-[#2a3439]">{stats.mainAgents}</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-[#dae2fd] rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-[#4a5167] text-lg">store</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Branch Agents</span>
          </div>
          <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] text-[#2a3439]">{stats.branchAgents}</p>
        </div>

        <div className="bg-[#0b0f10] text-white p-6 rounded-xl relative overflow-hidden">
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 bg-white/10 rounded-lg flex items-center justify-center">
                <span className="material-symbols-outlined text-[#dae2fd] text-lg">emoji_events</span>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Top Earner</span>
            </div>
            <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)]">
              {stats.topEarner ? formatCurrency(stats.topEarner.amount) : "—"}
            </p>
            {stats.topEarner && (
              <p className="text-xs text-slate-400 mt-1">{stats.topEarner.name}</p>
            )}
          </div>
          <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/5 rounded-full blur-3xl" />
        </div>
      </div>

      {/* Table */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-[#566166] text-lg">account_tree</span>
          <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166]">Agent Network</h3>
        </div>

        <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#f0f4f7] text-left">
                  <th className="px-3 py-4 w-10" />
                  <th className="px-4 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Agent</th>
                  <th className="px-4 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Branch</th>
                  <th className="px-4 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Level</th>
                  <th className="px-4 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Clients</th>
                  <th className="px-4 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Sub-agents</th>
                  <th className="px-4 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Commission</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#a9b4b9]/10">
                {agents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-16 text-center">
                      <span className="material-symbols-outlined text-4xl text-[#a9b4b9] mb-3 block">group</span>
                      <p className="text-sm font-medium text-[#566166]">No agents yet</p>
                      <p className="text-xs text-[#a9b4b9] mt-1">Users with referrals will appear here</p>
                    </td>
                  </tr>
                ) : (
                  agents.map((row, i) => (
                    <AgentRowComponent
                      key={row.id}
                      row={row}
                      depth={0}
                      expandedIds={expandedIds}
                      toggleExpand={toggleExpand}
                      rowIndex={i}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
