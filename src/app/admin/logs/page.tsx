"use client";

import { useState, useEffect, useCallback } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

type Severity = "info" | "warn" | "error" | "critical";
type FilterType = "all" | "critical" | "error" | "unacknowledged";

interface SystemLog {
  id: string;
  severity: Severity;
  source: string;
  message: string;
  context: Record<string, unknown>;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

const SEVERITY_STYLES: Record<Severity, { bg: string; text: string; label: string }> = {
  critical: { bg: "bg-red-100", text: "text-red-700", label: "CRITICAL" },
  error: { bg: "bg-orange-100", text: "text-orange-700", label: "ERROR" },
  warn: { bg: "bg-yellow-100", text: "text-yellow-700", label: "WARN" },
  info: { bg: "bg-blue-100", text: "text-blue-700", label: "INFO" },
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDateUTC(iso: string) {
  return new Date(iso).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function buildCopyText(log: SystemLog) {
  return `[${log.severity.toUpperCase()}] ${formatDateUTC(log.created_at)}
Source: ${log.source}
Message: ${log.message}
Context: ${JSON.stringify(log.context, null, 2)}
Log ID: ${log.id}`;
}

export default function AdminLogsPage() {
  const supabase = useSupabase();
  const t = useTranslations("toast");
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("system_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (filter === "critical") {
      query = query.eq("severity", "critical");
    } else if (filter === "error") {
      query = query.in("severity", ["error", "critical"]);
    } else if (filter === "unacknowledged") {
      query = query.eq("acknowledged", false);
    }

    const { data, error } = await query;
    if (error) {
      toast.error(t("failedToLoadLogs"), { description: error.message });
    } else {
      setLogs((data as SystemLog[]) || []);
    }
    setLoading(false);
  }, [supabase, filter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleAcknowledge = async (logId: string) => {
    const { error } = await supabase.rpc("acknowledge_system_log", {
      p_log_id: logId,
    });

    if (error) {
      toast.error(t("failedToAcknowledge"), { description: error.message });
      return;
    }

    toast.success(t("logAcknowledged"));
    setLogs((prev) =>
      prev.map((l) =>
        l.id === logId ? { ...l, acknowledged: true, acknowledged_at: new Date().toISOString() } : l
      )
    );
  };

  const handleCopy = async (log: SystemLog) => {
    await navigator.clipboard.writeText(buildCopyText(log));
    toast.success(t("copiedToClipboard"));
  };

  const filters: { key: FilterType; label: string }[] = [
    { key: "all", label: "All" },
    { key: "critical", label: "Critical" },
    { key: "error", label: "Errors" },
    { key: "unacknowledged", label: "Unacknowledged" },
  ];

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
          System Logs
        </h2>
        <p className="text-[#566166] mt-2 max-w-lg">
          Error tracking and debugging. Copy any error to share with engineering.
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
              filter === f.key
                ? "bg-[var(--yes)] text-white shadow-sm"
                : "bg-white text-[#566166] hover:bg-[#f0f4f7] shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
            )}
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={fetchLogs}
          className="ml-auto px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider bg-white text-[#566166] hover:bg-[#f0f4f7] shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-sm">refresh</span>
          Refresh
        </button>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
        {loading ? (
          <div className="px-6 py-16 text-center">
            <div className="animate-spin w-6 h-6 border-2 border-[var(--yes)] border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-sm text-[#566166]">Loading logs...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <span
              className="material-symbols-outlined text-4xl text-emerald-400 mb-3 block"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              verified
            </span>
            <p className="text-sm font-medium text-[#2a3439]">No logs found</p>
            <p className="text-xs text-[#a9b4b9] mt-1">
              {filter === "all" ? "System is running cleanly" : "No matching logs for this filter"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#a9b4b9]/10">
            {logs.map((log, i) => {
              const style = SEVERITY_STYLES[log.severity];
              const isExpanded = expandedId === log.id;

              return (
                <div
                  key={log.id}
                  className={cn(
                    "transition-colors",
                    i % 2 === 1 ? "bg-[#f0f4f7]/20" : "",
                    log.acknowledged ? "opacity-60" : ""
                  )}
                >
                  {/* Main row */}
                  <div
                    className="flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-[#f0f4f7]/50"
                    onClick={() => setExpandedId(isExpanded ? null : log.id)}
                  >
                    {/* Severity badge */}
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-bold tracking-wider shrink-0",
                        style.bg,
                        style.text
                      )}
                    >
                      {style.label}
                    </span>

                    {/* Timestamp */}
                    <span className="text-xs text-[#a9b4b9] font-mono tabular-nums shrink-0 w-36">
                      {formatDate(log.created_at)}
                    </span>

                    {/* Source */}
                    <span className="text-xs text-[#566166] font-mono shrink-0 w-40 truncate">
                      {log.source}
                    </span>

                    {/* Message */}
                    <span className="text-sm text-[#2a3439] truncate flex-1">
                      {log.message}
                    </span>

                    {/* Status */}
                    {log.acknowledged && (
                      <span className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider shrink-0">
                        ACK
                      </span>
                    )}

                    {/* Expand icon */}
                    <span className="material-symbols-outlined text-[#a9b4b9] text-sm shrink-0">
                      {isExpanded ? "expand_less" : "expand_more"}
                    </span>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-6 pb-5 pt-1 space-y-3">
                      {/* Context JSON */}
                      <div className="bg-[#f0f4f7] rounded-lg p-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#566166] mb-2">
                          Context
                        </p>
                        <pre className="text-xs text-[#2a3439] font-mono whitespace-pre-wrap break-all">
                          {JSON.stringify(log.context, null, 2)}
                        </pre>
                      </div>

                      {/* Meta */}
                      <div className="flex items-center gap-3 text-xs text-[#a9b4b9]">
                        <span>ID: {log.id.slice(0, 8)}...</span>
                        {log.acknowledged_at && (
                          <span>Acknowledged: {formatDate(log.acknowledged_at)}</span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(log);
                          }}
                          className="px-4 py-2 rounded-lg text-xs font-bold bg-[#2a3439] text-white hover:bg-[#2a3439]/90 transition-colors flex items-center gap-1.5"
                        >
                          <span className="material-symbols-outlined text-sm">content_copy</span>
                          Copy for debugging
                        </button>

                        {!log.acknowledged && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAcknowledge(log.id);
                            }}
                            className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors flex items-center gap-1.5"
                          >
                            <span className="material-symbols-outlined text-sm">check</span>
                            Acknowledge
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
