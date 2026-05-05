"use client";

// Manual adjust tab on /admin/money.
// Form: pick user (autocomplete), amount, direction (Credit/Debit toggle),
// reason. Submit calls /api/admin/balance-adjust which writes to the
// transactions ledger via admin_balance_adjust_v2.

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Loader2, MinusCircle, PlusCircle } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";

interface FoundUser {
  id: string;
  email: string | null;
  display_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  balance_usd: number;
  is_admin: boolean;
  is_frozen: boolean;
}

type Direction = "credit" | "debit";

export function MoneyAdjustTab() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoundUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [user, setUser] = useState<FoundUser | null>(null);
  const [direction, setDirection] = useState<Direction>("credit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, startSubmit] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ amount: number; type: string; new_balance: number } | null>(
    null
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced user search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (user) return; // hide results once a user is locked in
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/admin/users/search?q=${encodeURIComponent(query.trim())}`);
        if (!r.ok) {
          setResults([]);
          return;
        }
        const body = (await r.json()) as { users: FoundUser[] };
        setResults(body.users ?? []);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, user]);

  const numAmount = Number(amount);
  const canSubmit =
    !!user &&
    Number.isFinite(numAmount) &&
    numAmount > 0 &&
    numAmount <= 10000 &&
    reason.trim().length >= 3 &&
    !submitting;

  const submit = () => {
    if (!user) return;
    const signed = direction === "credit" ? numAmount : -numAmount;
    const verb = direction === "credit" ? "Credit" : "Debit";
    if (
      !confirm(
        `${verb} ${formatCurrency(numAmount)} ${direction === "credit" ? "to" : "from"} ${user.email ?? user.display_name}?\n\nNew balance after: ${formatCurrency(user.balance_usd + signed)}\nReason: "${reason.trim()}"\n\nThis writes a row to the ledger and cannot be undone — only via the opposite adjustment.`
      )
    ) {
      return;
    }
    setError(null);
    startSubmit(async () => {
      const r = await fetch("/api/admin/balance-adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          amount: signed,
          reason: reason.trim(),
        }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? `Failed (${r.status})`);
        return;
      }
      const body = (await r.json()) as {
        amount: number;
        type: string;
        new_balance: number;
      };
      setDone({ amount: body.amount, type: body.type, new_balance: body.new_balance });
    });
  };

  const reset = () => {
    setQuery("");
    setResults([]);
    setUser(null);
    setDirection("credit");
    setAmount("");
    setReason("");
    setError(null);
    setDone(null);
  };

  if (done) {
    return (
      <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] p-8 max-w-[480px] mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
            <Check className="w-5 h-5 text-emerald-600" />
          </div>
          <h3 className="text-lg font-bold text-[#2a3439]">Adjustment posted</h3>
        </div>
        <dl className="text-sm space-y-2">
          <div className="flex justify-between border-b border-[#e9ecef] pb-2">
            <dt className="text-[#566166]">Type</dt>
            <dd className="font-mono text-xs text-[#2a3439]">{done.type}</dd>
          </div>
          <div className="flex justify-between border-b border-[#e9ecef] pb-2">
            <dt className="text-[#566166]">Amount</dt>
            <dd
              className={cn(
                "font-bold tabular-nums",
                done.amount >= 0 ? "text-emerald-700" : "text-red-700"
              )}
            >
              {done.amount >= 0 ? "+" : ""}
              {formatCurrency(done.amount)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[#566166]">New balance</dt>
            <dd className="font-bold tabular-nums text-[#2a3439]">
              {formatCurrency(done.new_balance)}
            </dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={reset}
          className="mt-6 w-full bg-[#2d6cdf] hover:bg-[#2d6cdf]/90 text-white font-semibold py-2.5 rounded-md text-sm"
        >
          New adjustment
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] p-8 max-w-[480px] mx-auto">
      <h3 className="text-lg font-bold text-[#2a3439] mb-1">Manual balance adjust</h3>
      <p className="text-xs text-[#717c82] mb-6">
        Credits or debits a user&apos;s balance and writes a row to the
        transactions ledger. Capped at $10,000 absolute.
      </p>

      {/* User picker */}
      <label className="block text-xs font-bold uppercase tracking-wider text-[#566166] mb-2">
        User
      </label>
      {user ? (
        <div className="flex items-center justify-between bg-[#f6f8fa] border border-[#e9ecef] rounded-md px-3 py-2 mb-4">
          <div className="flex flex-col text-sm">
            <span className="font-semibold text-[#2a3439]">
              {user.display_name ?? user.email ?? "—"}
            </span>
            <span className="text-xs text-[#717c82]">{user.email}</span>
            <span className="text-[10px] text-[#717c82]">
              balance {formatCurrency(user.balance_usd)}
              {user.is_frozen && <span className="ml-2 text-red-600 font-bold">FROZEN</span>}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setUser(null);
              setQuery("");
            }}
            className="text-xs text-[#717c82] hover:text-[#2a3439]"
          >
            Change
          </button>
        </div>
      ) : (
        <div className="relative mb-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by email, display name, or phone…"
            className="w-full h-10 px-3 border border-[#e9ecef] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#2d6cdf]/30 focus:border-[#2d6cdf]"
            autoComplete="off"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-2.5 w-4 h-4 text-[#717c82] animate-spin" />
          )}
          {results.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-[#e9ecef] rounded-md shadow-lg z-10 max-h-[280px] overflow-y-auto">
              {results.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    setUser(u);
                    setResults([]);
                    setQuery("");
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-[#f6f8fa] border-b border-[#e9ecef]/60 last:border-b-0"
                >
                  <div className="font-semibold text-sm text-[#2a3439]">
                    {u.display_name ?? u.email ?? "—"}
                  </div>
                  <div className="text-xs text-[#717c82] flex items-center gap-2">
                    <span>{u.email}</span>
                    <span className="text-[#a3aaaf]">·</span>
                    <span className="tabular-nums">{formatCurrency(u.balance_usd)}</span>
                    {u.is_frozen && <span className="text-red-600 font-bold">FROZEN</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Direction toggle */}
      <label className="block text-xs font-bold uppercase tracking-wider text-[#566166] mb-2">
        Direction
      </label>
      <div className="flex bg-[#f6f8fa] rounded-md p-1 mb-4">
        <button
          type="button"
          onClick={() => setDirection("credit")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-sm font-semibold transition-colors",
            direction === "credit"
              ? "bg-white shadow-sm text-emerald-700"
              : "text-[#566166] hover:text-[#2a3439]"
          )}
        >
          <PlusCircle className="w-3.5 h-3.5" /> Credit
        </button>
        <button
          type="button"
          onClick={() => setDirection("debit")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-sm font-semibold transition-colors",
            direction === "debit"
              ? "bg-white shadow-sm text-red-700"
              : "text-[#566166] hover:text-[#2a3439]"
          )}
        >
          <MinusCircle className="w-3.5 h-3.5" /> Debit
        </button>
      </div>

      {/* Amount */}
      <label className="block text-xs font-bold uppercase tracking-wider text-[#566166] mb-2">
        Amount (USD)
      </label>
      <input
        type="number"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.00"
        min="0"
        max="10000"
        step="0.01"
        className="w-full h-10 px-3 border border-[#e9ecef] rounded-md text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[#2d6cdf]/30 focus:border-[#2d6cdf] mb-4"
      />

      {/* Reason */}
      <label className="block text-xs font-bold uppercase tracking-wider text-[#566166] mb-2">
        Reason
      </label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. compensating for failed deposit · ticket #123"
        rows={2}
        className="w-full px-3 py-2 border border-[#e9ecef] rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#2d6cdf]/30 focus:border-[#2d6cdf] mb-2"
      />
      <p className="text-[10px] text-[#a3aaaf] mb-6">
        Stored in the transactions table. Visible in the user&apos;s history.
      </p>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 mb-4">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className={cn(
          "w-full font-semibold py-2.5 rounded-md text-sm transition-colors",
          direction === "credit"
            ? "bg-emerald-600 hover:bg-emerald-700 text-white"
            : "bg-red-600 hover:bg-red-700 text-white",
          !canSubmit && "opacity-40 cursor-not-allowed"
        )}
      >
        {submitting ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Posting…
          </span>
        ) : (
          `${direction === "credit" ? "Credit" : "Debit"} ${amount && Number.isFinite(numAmount) && numAmount > 0 ? formatCurrency(numAmount) : "—"}`
        )}
      </button>
    </div>
  );
}

