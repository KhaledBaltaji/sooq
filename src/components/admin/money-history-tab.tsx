"use client";

// History tab on /admin/money — the unified money ledger.
// Reads `transactions` directly via get_admin_money_ledger. Filters:
// date range (preset or custom), type (multi-select), free-text user
// search (debounced; resolves to user_id before the ledger fetch).

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";

type LedgerType = "deposit" | "withdrawal" | "admin_credit" | "admin_debit";

interface LedgerEntry {
  id: string;
  user_id: string;
  user: { email: string | null; display_name: string | null };
  type: LedgerType;
  amount: number;
  balance_after: number;
  description: string | null;
  reference_id: string | null;
  performed_by: string | null;
  performed_by_email: string | null;
  created_at: string;
}

interface SearchUser {
  id: string;
  email: string | null;
  display_name: string | null;
}

const TYPE_OPTIONS: { key: LedgerType; label: string }[] = [
  { key: "deposit", label: "Deposit" },
  { key: "withdrawal", label: "Withdrawal" },
  { key: "admin_credit", label: "Admin credit" },
  { key: "admin_debit", label: "Admin debit" },
];

const PRESETS: { key: string; label: string; days: number | null }[] = [
  { key: "all", label: "All time", days: null },
  { key: "30d", label: "30 days", days: 30 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "24h", label: "24 hours", days: 1 },
];

export function MoneyHistoryTab() {
  const [preset, setPreset] = useState("30d");
  const [types, setTypes] = useState<LedgerType[]>([]);
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<SearchUser[]>([]);
  const [pickedUser, setPickedUser] = useState<SearchUser | null>(null);
  const [rows, setRows] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fromIso = useMemo(() => {
    const days = PRESETS.find((p) => p.key === preset)?.days ?? null;
    if (days === null) return null;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
  }, [preset]);

  const fetchLedger = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (fromIso) qs.set("from", fromIso);
      if (types.length > 0) qs.set("types", types.join(","));
      if (pickedUser) qs.set("user_id", pickedUser.id);
      qs.set("limit", "500");
      const r = await fetch(`/api/admin/money-ledger?${qs.toString()}`);
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `Failed (${r.status})`);
      }
      const body = (await r.json()) as { entries: LedgerEntry[] };
      setRows(body.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromIso, types, pickedUser]);

  // Debounced user autocomplete (only when no user is picked)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (pickedUser) return;
    if (userQuery.trim().length < 2) {
      setUserResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/admin/users/search?q=${encodeURIComponent(userQuery.trim())}`);
        if (!r.ok) {
          setUserResults([]);
          return;
        }
        const body = (await r.json()) as { users: SearchUser[] };
        setUserResults(body.users ?? []);
      } catch {
        setUserResults([]);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [userQuery, pickedUser]);

  const toggleType = (t: LedgerType) => {
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  return (
    <div className="space-y-3">
      {/* Filter row */}
      <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#566166] mr-1">
            Range
          </span>
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreset(p.key)}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-semibold transition-colors",
                preset === p.key
                  ? "bg-[#2a3439] text-white"
                  : "bg-[#f6f8fa] text-[#566166] hover:text-[#2a3439]"
              )}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={fetchLedger}
            className="ml-auto p-1.5 rounded-md text-[#717c82] hover:text-[#2a3439] hover:bg-[#f0f4f7]"
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#566166] mr-1">
            Types
          </span>
          {TYPE_OPTIONS.map((t) => {
            const on = types.includes(t.key);
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => toggleType(t.key)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-semibold transition-colors",
                  on
                    ? "bg-[#2d6cdf] text-white"
                    : "bg-[#f6f8fa] text-[#566166] hover:text-[#2a3439]"
                )}
              >
                {t.label}
              </button>
            );
          })}
          {types.length > 0 && (
            <button
              type="button"
              onClick={() => setTypes([])}
              className="text-[10px] text-[#717c82] hover:text-[#2a3439] underline"
            >
              clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#566166]">
            User
          </span>
          {pickedUser ? (
            <div className="inline-flex items-center gap-2 bg-[#f6f8fa] border border-[#e9ecef] rounded-md px-2 py-1 text-xs">
              <span className="text-[#2a3439] font-semibold">
                {pickedUser.display_name ?? pickedUser.email}
              </span>
              <button
                type="button"
                onClick={() => {
                  setPickedUser(null);
                  setUserQuery("");
                }}
                className="text-[#717c82] hover:text-[#2a3439]"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="relative flex-1 max-w-[300px]">
              <input
                type="text"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                placeholder="Filter by user (email/name/phone)…"
                className="w-full h-8 px-2 border border-[#e9ecef] rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-[#2d6cdf]/30 focus:border-[#2d6cdf]"
                autoComplete="off"
              />
              {userResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-[#e9ecef] rounded-md shadow-lg z-10 max-h-[240px] overflow-y-auto">
                  {userResults.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => {
                        setPickedUser(u);
                        setUserResults([]);
                        setUserQuery("");
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-[#f6f8fa] border-b border-[#e9ecef]/60 last:border-b-0"
                    >
                      <div className="text-xs font-semibold text-[#2a3439]">
                        {u.display_name ?? u.email ?? "—"}
                      </div>
                      <div className="text-[10px] text-[#717c82]">{u.email}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-[#566166] flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-[#566166]">
            No ledger entries match these filters.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e9ecef] text-[10px] font-bold uppercase tracking-wider text-[#566166]">
                <th className="text-left px-5 py-3">When</th>
                <th className="text-left px-5 py-3">User</th>
                <th className="text-left px-5 py-3">Type</th>
                <th className="text-right px-5 py-3">Amount</th>
                <th className="text-right px-5 py-3">Balance after</th>
                <th className="text-left px-5 py-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <LedgerRow key={r.id} row={r} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && rows.length > 0 && (
        <p className="text-[10px] text-[#a3aaaf] text-right">
          {rows.length} entries · capped at 500 · narrow filters for older history
        </p>
      )}
    </div>
  );
}

function LedgerRow({ row }: { row: LedgerEntry }) {
  const date = new Date(row.created_at);
  const positive = row.amount >= 0;
  return (
    <tr className="border-b border-[#e9ecef]/60 last:border-b-0 hover:bg-[#fafbfc]">
      <td className="px-5 py-3 text-xs text-[#566166] whitespace-nowrap">
        {date.toLocaleString()}
      </td>
      <td className="px-5 py-3">
        <div className="flex flex-col">
          <span className="font-semibold text-[#2a3439]">
            {row.user.display_name ?? row.user.email ?? "—"}
          </span>
          <span className="text-xs text-[#717c82]">{row.user.email}</span>
        </div>
      </td>
      <td className="px-5 py-3">
        <TypeChip type={row.type} />
      </td>
      <td
        className={cn(
          "px-5 py-3 text-right tabular-nums font-bold whitespace-nowrap",
          positive ? "text-emerald-700" : "text-red-700"
        )}
      >
        {positive ? "+" : ""}
        {formatCurrency(row.amount)}
      </td>
      <td className="px-5 py-3 text-right tabular-nums text-[#2a3439] whitespace-nowrap">
        {formatCurrency(row.balance_after)}
      </td>
      <td className="px-5 py-3 text-xs text-[#566166] max-w-[320px]">
        {row.description ?? "—"}
        {row.performed_by_email && (
          <span className="block text-[10px] text-[#a3aaaf] mt-0.5">
            by {row.performed_by_email}
          </span>
        )}
      </td>
    </tr>
  );
}

function TypeChip({ type }: { type: LedgerType }) {
  const map: Record<LedgerType, { label: string; cls: string }> = {
    deposit: { label: "Deposit", cls: "bg-emerald-50 text-emerald-700" },
    withdrawal: { label: "Withdrawal", cls: "bg-amber-50 text-amber-700" },
    admin_credit: { label: "Admin credit", cls: "bg-[#eef4ff] text-[#2d6cdf]" },
    admin_debit: { label: "Admin debit", cls: "bg-red-50 text-red-700" },
  };
  const v = map[type];
  return (
    <span
      className={cn(
        "inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded",
        v.cls
      )}
    >
      {v.label}
    </span>
  );
}
