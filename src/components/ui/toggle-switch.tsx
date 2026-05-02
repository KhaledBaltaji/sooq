"use client";

import { cn } from "@/lib/utils";

interface ToggleSwitchProps {
  enabled: boolean;
  onToggle: () => void;
  size?: "sm" | "default";
}

export function ToggleSwitch({ enabled, onToggle, size = "default" }: ToggleSwitchProps) {
  const isSmall = size === "sm";

  return (
    <button
      onClick={onToggle}
      className="flex items-center cursor-pointer flex-shrink-0 min-h-11 md:min-h-0"
    >
      <span
        className={cn(
          "rounded-full transition-colors duration-200 relative",
          isSmall ? "w-8 h-[18px]" : "w-10 h-[22px]",
          enabled ? "bg-yes" : "bg-muted-custom"
        )}
      >
        <span
          className={cn(
            "absolute rounded-full bg-white shadow-sm transition-transform duration-200",
            isSmall
              ? "top-[2px] left-[2px] w-[14px] h-[14px]"
              : "top-[3px] left-[3px] w-4 h-4",
            enabled
              ? isSmall ? "translate-x-[14px]" : "translate-x-[18px]"
              : "translate-x-0"
          )}
        />
      </span>
    </button>
  );
}
