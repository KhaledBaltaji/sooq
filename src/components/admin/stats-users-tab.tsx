"use client";

// Phase 5K — Users tab. DAU / WAU / total / new-signups KPIs + the
// existing winners/losers/volume leaderboard.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, UserPlus, Activity, Zap, Loader2 } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { Kpi } from "./stats-kpi";

type UserSort = "winners" | "losers" | "volume";

const USER_SORTS: { key: UserSort; label: string }[] = [
  { key: "winners", label: "Top winners" },
  { key: "losers", label: "Top losers" },
  { key: "volume", label: "Top volume" },
];

interface UserActivity {
  total_users: number;
  dau: number;
  wau: number;
  new_signups: number;
  currently_shaded: number;
}

interface UserPnl {
  user_id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  position_count: number;
  total_stakes: number;
  total_payouts: number;
  net_pnl: number;
  open_positions: number;
  open_stake_total: number;
}

export function StatsUsersTab({
  isoRange,
}: {
  isoRange: { from: string | null; to: string | null };
}) {
  const [activity, setActivity] = useState<UserActivity | null>(null);
  const [users, setUsers] = useState<UserPnl[]>([]);
  const [userSort, setUserSort] = useState<UserSort>("winners");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setErr(null);

    const activityParams = new URLSearchParams();
    if (isoRange.from) activityParams.set("from", isoRange.from);
    if (isoRange.to) activityParams.set("to", isoRange.to);

    const userParams = new URLSearchParams({
      sort: userSort,
      limit: "20",
    });

    Promise.all([
      fetch(
        `/api/admin/stats/user-activity?${activityParams.toString()}`,
        { signal: ctrl.signal },
      ).then((r) => r.json()),
      fetch(`/api/admin/stats/user-pnl?${userParams.toString()}`, {
        signal: ctrl.signal,
      }).then((r) => r.json()),
    ])
      .then(([a, u]) => {
        if (a.error) setErr(a.error);
        else setActivity(a);
        setUsers(u.users ?? []);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setErr(e.message ?? "Load failed");
      })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [isoRange.from, isoRange.to, userSort]);

  if (err) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        {err}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Total users"
          value={activity ? activity.total_users.toLocaleString() : "—"}
          icon={<Users className="w-4 h-4" />}
          tone="muted"
          hint="All accounts"
        />
        <Kpi
          label="DAU"
          value={activity ? activity.dau.toLocaleString() : "—"}
          icon={<Activity className="w-4 h-4" />}
          tone="good"
          hint="Active in last 24h"
        />
        <Kpi
          label="WAU"
          value={activity ? activity.wau.toLocaleString() : "—"}
          icon={<Zap className="w-4 h-4" />}
          tone="good"
          hint="Active in last 7d"
        />
        <Kpi
          label="New signups"
          value={activity ? activity.new_signups.toLocaleString() : "—"}
          icon={<UserPlus className="w-4 h-4" />}
          tone="muted"
          hint="In selected range"
        />
      </div>

      {activity && (
        <Link
          href="/admin/sharks"
          className="inline-flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-900 hover:bg-amber-100 transition-colors"
        >
          <span className="material-symbols-outlined text-base text-amber-700">
            gpp_maybe
          </span>
          <span>
            <strong>{activity.currently_shaded}</strong> user
            {activity.currently_shaded === 1 ? "" : "s"} currently shaded by
            CLV throttle
          </span>
          <span className="ml-1 font-semibold">→</span>
        </Link>
      )}

      <section>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <h3 className="text-xl font-bold text-[#2a3439]">Leaderboard</h3>
          <div className="inline-flex gap-2">
            {USER_SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setUserSort(s.key)}
                className={cn(
                  "px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-md transition-colors",
                  userSort === s.key
                    ? "bg-[#2a3439] text-white"
                    : "bg-white text-[#566166] hover:text-[#2a3439] border border-[#e9ecef]",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
          {loading && users.length === 0 ? (
            <div className="p-8 text-center text-[#566166]">
              <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" />
              Loading…
            </div>
          ) : users.length === 0 ? (
            <div className="p-8 text-center text-[#566166]">No users yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e9ecef] text-[10px] font-bold uppercase tracking-wider text-[#566166]">
                  <th className="text-left px-4 py-3">User</th>
                  <th className="text-right px-4 py-3">Trades</th>
                  <th className="text-right px-4 py-3">Total staked</th>
                  <th className="text-right px-4 py-3">Total paid out</th>
                  <th className="text-right px-4 py-3">Net P&amp;L</th>
                  <th className="text-right px-4 py-3">Open</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.user_id}
                    className="border-b border-[#e9ecef]/60 last:border-b-0 hover:bg-[#fafbfc]"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold">
                        {u.display_name ?? u.email ?? "—"}
                      </div>
                      <div className="text-[10px] text-[#717c82]">
                        {u.email}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {u.position_count}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCurrency(u.total_stakes)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCurrency(u.total_payouts)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right tabular-nums font-bold",
                        u.net_pnl > 0
                          ? "text-emerald-700"
                          : u.net_pnl < 0
                            ? "text-red-700"
                            : "",
                      )}
                    >
                      {u.net_pnl > 0 ? "+" : ""}
                      {formatCurrency(u.net_pnl)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-xs text-[#566166]">
                      {u.open_positions}
                      <span className="ml-1">
                        ({formatCurrency(u.open_stake_total)})
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
