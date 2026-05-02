"use client";

import { useState } from "react";
import { format, subDays, startOfYear, startOfDay } from "date-fns";

export type RangeKey = "7d" | "30d" | "90d" | "ytd" | "all" | "custom";

const PRESETS: { key: RangeKey; label: string }[] = [
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "ytd", label: "YTD" },
  { key: "all", label: "All" },
  { key: "custom", label: "Custom" },
];

function getRange(key: RangeKey): { start: Date; end: Date } {
  const end = new Date();
  switch (key) {
    case "7d": return { start: startOfDay(subDays(end, 7)), end };
    case "30d": return { start: startOfDay(subDays(end, 30)), end };
    case "90d": return { start: startOfDay(subDays(end, 90)), end };
    case "ytd": return { start: startOfYear(end), end };
    case "all": return { start: new Date("2024-01-01"), end };
    default: return { start: startOfDay(subDays(end, 30)), end };
  }
}

interface Props {
  onChange: (start: string, end: string) => void;
}

export function StatsDatePicker({ onChange }: Props) {
  const [active, setActive] = useState<RangeKey>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const handlePreset = (key: RangeKey) => {
    setActive(key);
    if (key !== "custom") {
      const { start, end } = getRange(key);
      onChange(start.toISOString(), end.toISOString());
    }
  };

  const handleCustomApply = () => {
    if (customStart && customEnd) {
      onChange(new Date(customStart).toISOString(), new Date(customEnd + "T23:59:59").toISOString());
    }
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex bg-[#f0f4f7] rounded-lg p-1">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => handlePreset(p.key)}
            className={`px-3 py-1.5 text-[11px] font-bold rounded-md transition-all ${
              active === p.key
                ? "bg-white text-[#2a3439] shadow-sm"
                : "text-[#566166] hover:text-[#2a3439]"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {active === "custom" && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="text-xs border border-[#e8eff3] rounded-lg px-2 py-1.5 text-[#2a3439]"
          />
          <span className="text-xs text-[#566166]">to</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            max={format(new Date(), "yyyy-MM-dd")}
            className="text-xs border border-[#e8eff3] rounded-lg px-2 py-1.5 text-[#2a3439]"
          />
          <button
            onClick={handleCustomApply}
            className="text-[11px] font-bold px-3 py-1.5 bg-[var(--yes)] text-white rounded-lg hover:opacity-90"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
