"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils";
import type { ActivityEvent, EventCategory } from "@/app/admin/page";

const FILTERS: { label: string; value: EventCategory | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Trades", value: "trade" },
  { label: "Deposits", value: "deposit" },
  { label: "Withdrawals", value: "withdrawal" },
  { label: "Markets", value: "market" },
  { label: "Signups", value: "signup" },
  { label: "Commissions", value: "commission" },
  { label: "System", value: "system" },
];

export function ActivityFeedClient({ events }: { events: ActivityEvent[] }) {
  const [filter, setFilter] = useState<EventCategory | "all">("all");

  const filtered = filter === "all" ? events : events.filter((e) => e.category === filter);

  return (
    <div className="space-y-6">
      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-bold tracking-wide transition-colors",
              filter === f.value
                ? "bg-[#0b0f10] text-white"
                : "bg-white text-[#566166] hover:bg-[#e8eff3]"
            )}
          >
            {f.label}
            {f.value !== "all" && (
              <span className="ml-1.5 opacity-60">
                {events.filter((e) => e.category === f.value).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Timeline */}
      {filtered.length > 0 ? (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-5 top-3 bottom-3 w-px bg-[#e8eff3]" />

          <div className="space-y-1">
            {filtered.map((event) => (
              <div
                key={event.id}
                className="relative flex items-start gap-4 pl-12 pr-4 py-3 rounded-lg hover:bg-[#f0f4f7]/60 transition-colors group"
              >
                {/* Dot on timeline */}
                <div
                  className="absolute left-3 top-4 w-4 h-4 rounded-full border-2 border-white shadow-sm flex items-center justify-center"
                  style={{ backgroundColor: event.color }}
                />

                {/* Icon */}
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `color-mix(in srgb, ${event.color} 12%, transparent)` }}
                >
                  <span
                    className="material-symbols-outlined text-lg"
                    style={{ color: event.color }}
                  >
                    {event.icon}
                  </span>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-[#2a3439] font-[family-name:var(--font-manrope)]">
                      {event.title}
                    </p>
                    {event.severity === "critical" && (
                      <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[9px] font-bold rounded">
                        CRITICAL
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#566166] mt-0.5 truncate">
                    {event.description}
                  </p>
                </div>

                {/* Time + user */}
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px] text-[#a9b4b9] font-medium">
                    {timeAgo(event.timestamp, { compact: true })}
                  </p>
                  {event.userId && (
                    <p className="text-[10px] text-[#a9b4b9] mt-0.5 font-mono opacity-0 group-hover:opacity-100 transition-opacity">
                      {event.userId.slice(0, 8)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-[#566166]">
          <span className="material-symbols-outlined text-4xl mb-3 text-[#a9b4b9]">
            timeline
          </span>
          <p className="text-sm font-medium">No activity yet</p>
          <p className="text-xs mt-1">
            Platform events will appear here as they happen.
          </p>
        </div>
      )}
    </div>
  );
}
