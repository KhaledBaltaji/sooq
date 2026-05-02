"use client";

import { useState } from "react";
import { HELP_ICON_OPTIONS, getHelpIcon } from "@/lib/help-utils";

interface IconPickerProps {
  value: string;
  onChange: (icon: string) => void;
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  const [expanded, setExpanded] = useState(false);
  const SelectedIcon = getHelpIcon(value);

  return (
    <div className="space-y-3">
      {/* Selected icon display */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-3 px-4 py-3 bg-[#f0f4f7] rounded-lg hover:bg-[#e8eff3] transition-all w-full text-left"
      >
        <div className="w-9 h-9 rounded-lg bg-[var(--yes)]/10 flex items-center justify-center">
          <SelectedIcon className="w-5 h-5 text-[var(--yes)]" />
        </div>
        <div className="flex-1">
          <span className="text-sm font-semibold text-[#2a3439]">{value}</span>
          <p className="text-[10px] text-[#a9b4b9]">Click to {expanded ? "collapse" : "change icon"}</p>
        </div>
        <span className="material-symbols-outlined text-[#566166] text-sm transition-transform" style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>
          expand_more
        </span>
      </button>

      {/* Icon grid */}
      {expanded && (
        <div className="flex flex-wrap gap-2 p-3 bg-[#f0f4f7] rounded-lg">
          {HELP_ICON_OPTIONS.map((name) => {
            const Icon = getHelpIcon(name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => {
                  onChange(name);
                  setExpanded(false);
                }}
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
                  value === name
                    ? "bg-[var(--yes)]/10 text-[var(--yes)] ring-1 ring-[var(--yes)]"
                    : "bg-white text-[#566166] hover:text-[#2a3439] hover:bg-[#e8eff3] shadow-sm"
                }`}
                title={name}
              >
                <Icon className="w-4 h-4" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
