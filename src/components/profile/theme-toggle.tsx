"use client";

import { useTheme } from "@/components/providers/theme-provider";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-lg transition-colors",
        "bg-elevated hover:bg-elevated/80 text-text"
      )}
    >
      {theme === "dark" ? (
        <>
          <Moon className="w-4 h-4" />
          <span className="text-sm font-dm-sans">Dark</span>
        </>
      ) : (
        <>
          <Sun className="w-4 h-4" />
          <span className="text-sm font-dm-sans">Light</span>
        </>
      )}
    </button>
  );
}
