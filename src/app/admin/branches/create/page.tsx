"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSupabase } from "@/components/providers/supabase-provider";
import { toast } from "sonner";
import { validateSlug } from "@/lib/slug-rules";

type Step = 1 | 2 | 3;
type BookType = "reseller" | "commission";

// The book_type selector is ALWAYS visible to admin (no feature flag gate).
// Rationale: admins are trusted, commission is a real enum value, and gating
// admin creation behind NEXT_PUBLIC_COMMISSION_BRANCH_ENABLED left admins
// confused ("where's the Type selector?"). The feature flag now only gates
// user-facing surfaces: src/app/branch/layout.tsx checks it before rendering
// the commission-branch manager dashboard, so a commission branch created by
// admin before the flag is on still exists in DB but its manager can't open
// the dashboard until the flag flips.

export default function CreateBranchPage() {
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = useSupabase() as any;

  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [bookType, setBookType] = useState<BookType>("reseller");

  // Step 1: Basic info
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [managerSearch, setManagerSearch] = useState("");
  const [managerId, setManagerId] = useState("");
  const [managerName, setManagerName] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; display_name: string | null; phone: string | null }[]>([]);

  // Step 2: Config (reseller only — commission skips this step)
  const [yesMarkup, setYesMarkup] = useState("5");
  const [noMarkup, setNoMarkup] = useState("5");
  const [feeRate, setFeeRate] = useState("0.5");
  const [exitFee, setExitFee] = useState("0.5");
  const [displayMode, setDisplayMode] = useState("trading");
  const [cashOutEnabled, setCashOutEnabled] = useState(true);

  // Step 3: PIN
  const [pin, setPin] = useState("");

  // Commission branches enforce strict slug rules via shared helper
  const slugValidation = useMemo(() => {
    if (bookType !== "commission" || !code) return { ok: true };
    return validateSlug(code);
  }, [bookType, code]);

  const searchUsers = async (query: string) => {
    setManagerSearch(query);
    if (query.length < 2) { setSearchResults([]); return; }
    const sanitized = query.replace(/[%_,().*]/g, "");
    if (!sanitized) { setSearchResults([]); return; }

    const { data } = await supabase
      .from("users")
      .select("id, display_name, phone")
      .or(`display_name.ilike.%${sanitized}%,phone.ilike.%${sanitized}%`)
      .limit(5);

    setSearchResults(data || []);
  };

  const selectManager = (user: typeof searchResults[0]) => {
    setManagerId(user.id);
    setManagerName(user.display_name || user.phone || user.id.slice(0, 8));
    setManagerSearch("");
    setSearchResults([]);
  };

  // Code input handler varies by book_type. Commission = lowercase alphanum + hyphen.
  // Reseller (legacy) = uppercase alphanum + hyphen.
  const handleCodeChange = (raw: string) => {
    if (bookType === "commission") {
      setCode(raw.replace(/[^a-z0-9-]/g, "").toLowerCase().slice(0, 20));
    } else {
      setCode(raw.replace(/[^a-zA-Z0-9-]/g, "").toUpperCase().slice(0, 20));
    }
  };

  // Going back to book_type choice clears the code (rules differ)
  const handleBookTypeChange = (next: BookType) => {
    setBookType(next);
    setCode("");
  };

  const handleCreate = async () => {
    setLoading(true);

    const rpcArgs: Record<string, unknown> = {
      p_name: name,
      p_code: bookType === "commission" ? code : code.toUpperCase(),
      p_manager_user_id: managerId,
      p_pin: pin,
      p_book_type: bookType,
    };

    if (bookType === "reseller") {
      rpcArgs.p_config = {
        yes_markup_pct: parseFloat(yesMarkup) / 100,
        no_markup_pct: parseFloat(noMarkup) / 100,
        branch_fee_rate: parseFloat(feeRate) / 100,
        exit_fee_pct: parseFloat(exitFee) / 100,
        display_mode: displayMode,
        cash_out_enabled: cashOutEnabled,
      };
    }

    const { data, error } = await supabase.rpc("admin_create_branch", rpcArgs);

    if (error) {
      toast.error("Failed to create branch", { description: error.message });
      setLoading(false);
      return;
    }

    const result = data as { branch_id?: string } | null;
    toast.success("Branch created successfully");
    router.push(`/admin/branches/${result?.branch_id || ""}`);
  };

  // Step 1 complete when all required fields are valid
  const step1Valid = Boolean(
    name &&
    code &&
    managerId &&
    (bookType !== "commission" || slugValidation.ok)
  );

  // Commission branches skip Step 2; next button jumps straight to Step 3
  const handleNextFromStep1 = () => {
    setStep(bookType === "commission" ? 3 : 2);
  };

  const handleBackFromStep3 = () => {
    setStep(bookType === "commission" ? 1 : 2);
  };

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-[#566166] mb-8">
        <Link href="/admin/branches" className="hover:text-[var(--yes)] transition-colors">Branches</Link>
        <span className="material-symbols-outlined text-xs">chevron_right</span>
        <span className="text-[#2a3439] font-semibold">Create Branch</span>
      </div>

      <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)] mb-2">
        Create Branch
      </h2>
      <p className="text-[#566166] mb-10">Set up a new branch operator.</p>

      {/* Progress Steps — commission skips step 2 */}
      <div className="flex items-center gap-4 mb-10">
        {(bookType === "commission" ? [1, 3] : [1, 2, 3]).map((s, i, arr) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              step >= s ? "bg-[var(--yes)] text-white" : "bg-[#e8eff3] text-[#566166]"
            }`}>
              {i + 1}
            </div>
            <span className={`text-sm font-medium ${step >= s ? "text-[#2a3439]" : "text-[#566166]"}`}>
              {s === 1 ? "Basic Info" : s === 2 ? "Configuration" : "Review & Create"}
            </span>
            {i < arr.length - 1 && <div className="w-12 h-0.5 bg-[#d9e4ea]" />}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        {step === 1 && (
          <div className="space-y-6">
            {/* Book type selector — always visible to admins */}
            <div>
              <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-2 block">
                Branch Type
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleBookTypeChange("reseller")}
                  className={`text-left p-4 rounded-xl border-2 transition-all ${
                    bookType === "reseller"
                      ? "border-[var(--yes)] bg-blue-50/50"
                      : "border-[#d9e4ea] hover:border-[#b8c7cf]"
                  }`}
                >
                  <div className="font-bold text-sm text-[#2a3439]">Reseller</div>
                  <div className="text-xs text-[#566166] mt-1">
                    Holds a pool, sets markup, takes risk
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleBookTypeChange("commission")}
                  className={`text-left p-4 rounded-xl border-2 transition-all ${
                    bookType === "commission"
                      ? "border-indigo-500 bg-indigo-50/50"
                      : "border-[#d9e4ea] hover:border-[#b8c7cf]"
                  }`}
                >
                  <div className="font-bold text-sm text-[#2a3439]">Commission</div>
                  <div className="text-xs text-[#566166] mt-1">
                    Branded URL + dashboard, no capital, commissions flow via referral chain
                  </div>
                </button>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">
                Branch Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                placeholder={bookType === "commission" ? "e.g., Alice Sports" : "e.g., Beirut Sports"}
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">
                Branch Slug
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => handleCodeChange(e.target.value)}
                maxLength={20}
                className={`w-full border rounded-lg px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none ${
                  bookType === "commission" && code && !slugValidation.ok
                    ? "border-red-400"
                    : "border-[#d9e4ea]"
                } ${bookType === "commission" ? "lowercase" : "uppercase"}`}
                placeholder={bookType === "commission" ? "e.g., alice-sports" : "e.g., BEI-SPORTS"}
              />
              <p className="text-xs text-[#566166] mt-1">
                URL preview: <span className="font-mono font-bold">/b/{code || (bookType === "commission" ? "your-slug" : "CODE")}</span>
              </p>
              {bookType === "commission" && code && !slugValidation.ok && slugValidation.message && (
                <p className="text-xs text-red-600 mt-1">{slugValidation.message}</p>
              )}
              {bookType === "commission" && (
                <p className="text-xs text-[#566166] mt-1">
                  3–20 chars. Lowercase letters, numbers, and hyphens. No leading/trailing hyphen.
                </p>
              )}
            </div>

            <div className="relative">
              <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">
                Branch Manager
              </label>
              {managerId ? (
                <div className="flex items-center gap-2 border border-[#d9e4ea] rounded-lg px-3 py-2.5">
                  <span className="text-sm font-semibold text-[#2a3439]">{managerName}</span>
                  <button onClick={() => { setManagerId(""); setManagerName(""); }} className="ml-auto text-xs text-[#566166] hover:text-red-500">
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={managerSearch}
                    onChange={(e) => searchUsers(e.target.value)}
                    className="w-full border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                    placeholder="Search by name or phone..."
                  />
                  {searchResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full bg-white border border-[#d9e4ea] rounded-lg shadow-lg">
                      {searchResults.map((u) => (
                        <button
                          key={u.id}
                          onClick={() => selectManager(u)}
                          className="w-full text-left px-4 py-3 hover:bg-[#f0f4f7] text-sm transition-colors first:rounded-t-lg last:rounded-b-lg"
                        >
                          <span className="font-semibold">{u.display_name || "No name"}</span>
                          <span className="text-[#566166] ml-2">{u.phone}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <button
              onClick={handleNextFromStep1}
              disabled={!step1Valid}
              className="w-full py-3 bg-[var(--yes)] text-white font-bold rounded-lg hover:opacity-90 transition-all disabled:opacity-40 text-sm"
            >
              {bookType === "commission" ? "Next: Review" : "Next: Configuration"}
            </button>
          </div>
        )}

        {step === 2 && bookType === "reseller" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">YES Markup (%)</label>
                <input type="number" value={yesMarkup} onChange={(e) => setYesMarkup(e.target.value)} min={0} max={50} step={0.5}
                  className="w-full border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">NO Markup (%)</label>
                <input type="number" value={noMarkup} onChange={(e) => setNoMarkup(e.target.value)} min={0} max={50} step={0.5}
                  className="w-full border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">Fee Rate (%)</label>
                <input type="number" value={feeRate} onChange={(e) => setFeeRate(e.target.value)} min={0} max={10} step={0.1}
                  className="w-full border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">Exit Fee (%)</label>
                <input type="number" value={exitFee} onChange={(e) => setExitFee(e.target.value)} min={0} max={10} step={0.1}
                  className="w-full border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none" />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">Display Mode</label>
              <div className="flex gap-3">
                {["trading", "betting"].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setDisplayMode(mode)}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      displayMode === mode ? "bg-[var(--yes)] text-white" : "bg-[#f0f4f7] text-[#566166] hover:bg-[#e8eff3]"
                    }`}
                  >
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest">Cash Out Enabled</label>
              <button
                onClick={() => setCashOutEnabled(!cashOutEnabled)}
                className={`w-12 h-6 rounded-full transition-colors ${cashOutEnabled ? "bg-emerald-500" : "bg-[#d9e4ea]"}`}
              >
                <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${cashOutEnabled ? "translate-x-6" : "translate-x-0.5"}`} />
              </button>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 py-3 bg-[#f0f4f7] text-[#566166] font-bold rounded-lg hover:bg-[#e8eff3] transition-all text-sm">
                Back
              </button>
              <button onClick={() => setStep(3)} className="flex-1 py-3 bg-[var(--yes)] text-white font-bold rounded-lg hover:opacity-90 transition-all text-sm">
                Next: Review
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div className="bg-[#f0f4f7] rounded-xl p-6 space-y-3">
              <p className="text-[10px] font-bold text-[#566166] uppercase tracking-widest">Review</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-[#566166]">Type:</span> <span className="font-semibold capitalize">{bookType}</span></div>
                <div><span className="text-[#566166]">Name:</span> <span className="font-semibold">{name}</span></div>
                <div><span className="text-[#566166]">Slug:</span> <span className="font-mono font-bold">{bookType === "commission" ? code : code.toUpperCase()}</span></div>
                <div><span className="text-[#566166]">Manager:</span> <span className="font-semibold">{managerName}</span></div>
                {bookType === "reseller" && (
                  <>
                    <div><span className="text-[#566166]">Display:</span> <span className="capitalize">{displayMode}</span></div>
                    <div><span className="text-[#566166]">YES Markup:</span> {yesMarkup}%</div>
                    <div><span className="text-[#566166]">NO Markup:</span> {noMarkup}%</div>
                    <div><span className="text-[#566166]">Fee Rate:</span> {feeRate}%</div>
                    <div><span className="text-[#566166]">Exit Fee:</span> {exitFee}%</div>
                    <div><span className="text-[#566166]">Cash Out:</span> {cashOutEnabled ? "Yes" : "No"}</div>
                  </>
                )}
                {bookType === "commission" && (
                  <>
                    <div className="col-span-2 text-xs text-[#566166] bg-indigo-50 rounded p-3">
                      Commission branches hold no pool. Users trade at retail prices. Manager earns L1–L4 commissions through the referral chain; sub-agents split layer 1 and layer 2 based on who brought the user in.
                    </div>
                  </>
                )}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">Admin PIN</label>
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                maxLength={6}
                className="w-full border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm font-mono tracking-[0.3em] text-center focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                placeholder="••••••"
              />
            </div>

            <div className="flex gap-3">
              <button onClick={handleBackFromStep3} className="flex-1 py-3 bg-[#f0f4f7] text-[#566166] font-bold rounded-lg hover:bg-[#e8eff3] transition-all text-sm">
                Back
              </button>
              <button
                onClick={handleCreate}
                disabled={loading || !pin}
                className="flex-1 py-3 bg-[var(--yes)] text-white font-bold rounded-lg hover:opacity-90 transition-all disabled:opacity-40 text-sm"
              >
                {loading ? "Creating..." : "Create Branch"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
