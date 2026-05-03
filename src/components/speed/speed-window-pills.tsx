"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { cn } from "@/lib/utils";
import { isMarketAligned } from "@/lib/speed/pricing";
import type {
  SpeedAsset,
  SpeedDuration,
  SpeedMarket,
  SpeedMarketOutcome,
  SpeedMarketStatus,
} from "@/types/database";

interface PillRow {
  id: string;
  opens_at: string;
  closes_at: string;
  status: SpeedMarketStatus;
  outcome: SpeedMarketOutcome | null;
}

type Tense = "past" | "live";

export function SpeedWindowPills({
  asset,
  duration,
  currentId,
}: {
  asset: SpeedAsset;
  duration: SpeedDuration;
  currentId: string;
}) {
  const t = useTranslations("speed");
  const isDesktop = useIsDesktop();
  const [now, setNow] = useState<number>(Date.now());
  const [pastOpen, setPastOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Today's midnight as the lower bound — recomputed each render is fine,
  // the value only changes when the day rolls over.
  const todayMidnightIso = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  })();

  const query = useQuery<{ markets: SpeedMarket[] }>({
    queryKey: ["speed-window-pills", asset, duration, todayMidnightIso],
    queryFn: async () => {
      const params = new URLSearchParams({
        asset,
        duration,
        since: todayMidnightIso,
        sort: "desc",
        limit: "50",
      });
      const res = await fetch(`/api/speed/markets?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to load window pills (${res.status})`);
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  // Convert API rows to the local PillRow shape, filter off-clock test
  // artifacts, then reverse to ascending so liveIdx + slicing below works.
  const rows: PillRow[] = (query.data?.markets ?? [])
    .filter((m) => isMarketAligned(m.opens_at, duration))
    .map((m) => ({
      id: m.id,
      opens_at: m.opens_at,
      closes_at: m.closes_at,
      status: m.status,
      outcome: m.outcome,
    }))
    .slice()
    .reverse();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Click outside closes the dropdown.
  useEffect(() => {
    if (!pastOpen) return;
    function onPointer(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setPastOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [pastOpen]);

  const liveIdx = rows.findIndex((r) => {
    const o = new Date(r.opens_at).getTime();
    const c = new Date(r.closes_at).getTime();
    return now >= o && now < c;
  });

  // Just two pills: "Past" archive on the left, "Live HH:MM" on the right.
  // The live pill is always the currently-running market — even if the user
  // is viewing a past market, clicking it jumps back to live.
  const liveRow = liveIdx >= 0 ? rows[liveIdx] : null;

  // Past archive = everything strictly before the live anchor (or all rows
  // if no live exists). Newest first for the dropdown.
  const archiveRows = (
    liveIdx >= 0 ? rows.slice(0, liveIdx) : rows.slice()
  )
    .slice()
    .reverse();

  if (rows.length === 0) return null;

  return (
    <div ref={containerRef} className="relative px-4 pb-1">
      <div className="inline-flex max-w-full items-center gap-1.5 overflow-x-auto scrollbar-none">
        <button
          type="button"
          aria-label="Show past markets"
          aria-expanded={pastOpen}
          disabled={archiveRows.length === 0}
          onClick={() => setPastOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide tabular-nums transition shrink-0",
            archiveRows.length === 0
              ? "bg-surface text-muted-custom opacity-50 pointer-events-none"
              : "bg-surface text-text hover:bg-bg",
          )}
        >
          <span>Past</span>
          <ChevronDown
            className={cn(
              "h-3 w-3 transition-transform duration-200",
              pastOpen && "rotate-180",
            )}
          />
        </button>
        {liveRow && (
          <Pill
            key={liveRow.id}
            row={liveRow}
            tense="live"
            isViewing={liveRow.id === currentId}
            liveLabel={t("live")}
          />
        )}
      </div>
      <AnimatePresence>
        {pastOpen &&
          archiveRows.length > 0 &&
          (isDesktop ? (
            <PastDropdown
              rows={archiveRows}
              currentId={currentId}
              onSelect={() => setPastOpen(false)}
            />
          ) : (
            <PastBottomSheet
              rows={archiveRows}
              currentId={currentId}
              onClose={() => setPastOpen(false)}
            />
          ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * Mobile-only bottom sheet variant of the past markets list. Renders into
 * `document.body` via portal so the sheet escapes the modal route's
 * overflow container and stacks above all other UI (chart overlays,
 * trade panel, etc.) — the popover version was conflicting at z-50 with
 * the modal's own z-50.
 */
function PastBottomSheet({
  rows,
  currentId,
  onClose,
}: {
  rows: PillRow[];
  currentId: string;
  onClose: () => void;
}) {
  // Body scroll-lock with position:fixed (same pattern as the speed modal).
  useEffect(() => {
    const scrollY = window.scrollY;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyPosition = body.style.position;
    const prevBodyTop = body.style.top;
    const prevBodyWidth = body.style.width;
    html.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.position = prevBodyPosition;
      body.style.top = prevBodyTop;
      body.style.width = prevBodyWidth;
      window.scrollTo(0, scrollY);
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        className="fixed inset-0 z-[100] bg-black/40"
        aria-hidden
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
        className="fixed bottom-0 inset-x-0 z-[101] bg-bg rounded-t-2xl max-h-[70vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Past markets"
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-1">
          <span className="h-1.5 w-10 rounded-full bg-border-custom" />
        </div>
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 pb-2">
          <span className="font-satoshi font-bold text-text">Past markets</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-custom hover:bg-surface transition-colors"
          >
            <X className="h-5 w-5" strokeWidth={2.25} />
          </button>
        </div>
        {/* Scrollable list */}
        <ul className="overflow-y-auto px-2 pb-4 space-y-0.5">
          {rows.map((row) => {
            const isViewing = row.id === currentId;
            return (
              <li key={row.id}>
                <Link
                  href={`/speed/${row.id}`}
                  onClick={onClose}
                  className={cn(
                    "grid grid-cols-[auto_1fr_auto] items-center gap-x-3 rounded-lg px-3 py-3 text-sm transition-colors hover:bg-surface",
                    isViewing && "bg-surface",
                  )}
                >
                  <span className="tabular-nums font-bold text-text">
                    {formatTime(new Date(row.closes_at))}
                  </span>
                  <span className="text-muted-custom">{outcomeLabel(row.outcome)}</span>
                  <OutcomeIcon outcome={row.outcome} />
                </Link>
              </li>
            );
          })}
        </ul>
      </motion.div>
    </>,
    document.body,
  );
}

function PastDropdown({
  rows,
  currentId,
  onSelect,
}: {
  rows: PillRow[];
  currentId: string;
  onSelect: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.97 }}
      transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
      className="absolute left-4 top-full z-50 mt-2 w-[200px] max-h-[280px] origin-top-left overflow-y-auto rounded-lg border border-border-custom bg-elevated p-1 shadow-lg"
    >
      <ul className="space-y-0.5">
        {rows.map((row) => {
          const isViewing = row.id === currentId;
          return (
            <li key={row.id}>
              <Link
                href={`/speed/${row.id}`}
                onClick={onSelect}
                className={cn(
                  "grid grid-cols-[auto_1fr_auto] items-center gap-x-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-surface",
                  isViewing && "bg-surface",
                )}
              >
                <span className="tabular-nums font-bold text-text">
                  {formatTime(new Date(row.closes_at))}
                </span>
                <span className="text-muted-custom">{outcomeLabel(row.outcome)}</span>
                <OutcomeIcon outcome={row.outcome} />
              </Link>
            </li>
          );
        })}
      </ul>
    </motion.div>
  );
}

function outcomeLabel(outcome: SpeedMarketOutcome | null): string {
  if (outcome === "over") return "Over";
  if (outcome === "under") return "Under";
  if (outcome === "at_strike") return "At strike";
  return "—";
}

function OutcomeIcon({ outcome }: { outcome: SpeedMarketOutcome | null }) {
  if (outcome === "over") {
    return (
      <span
        aria-label="Over"
        className="inline-flex h-4 w-4 items-center justify-center rounded bg-success text-text text-[8px] leading-none"
      >
        ▲
      </span>
    );
  }
  if (outcome === "under") {
    return (
      <span
        aria-label="Under"
        className="inline-flex h-4 w-4 items-center justify-center rounded bg-destructive text-white text-[8px] leading-none"
      >
        ▼
      </span>
    );
  }
  return (
    <span
      aria-label="No outcome"
      className="inline-flex h-4 w-4 items-center justify-center rounded bg-border-custom text-muted-custom text-[8px] leading-none"
    >
      —
    </span>
  );
}

function Pill({
  row,
  tense,
  isViewing,
  liveLabel,
}: {
  row: PillRow;
  tense: Tense;
  isViewing: boolean;
  liveLabel: string;
}) {
  const label = formatTime(new Date(row.closes_at));
  const baseClass =
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-bold tabular-nums transition shrink-0";

  if (tense === "live") {
    if (isViewing) {
      return (
        <span className={cn(baseClass, "bg-text text-bg")}>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
          <span className="uppercase tracking-wide">{liveLabel}</span>
          <span className="opacity-80">{label}</span>
        </span>
      );
    }
    return (
      <Link
        href={`/speed/${row.id}`}
        className={cn(baseClass, "bg-surface text-text hover:bg-bg")}
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
        <span className="uppercase tracking-wide">{liveLabel}</span>
        <span className="opacity-70">{label}</span>
      </Link>
    );
  }

  if (isViewing) {
    return <span className={cn(baseClass, "bg-text text-bg")}>{label}</span>;
  }

  return (
    <Link
      href={`/speed/${row.id}`}
      className={cn(baseClass, "bg-surface text-muted-custom hover:bg-bg hover:text-text")}
    >
      {label}
    </Link>
  );
}

function formatTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}
