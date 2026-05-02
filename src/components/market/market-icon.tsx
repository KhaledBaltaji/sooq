"use client";

import { cn } from "@/lib/utils";
import { Landmark, TrendingUp, Trophy, Globe, Cpu, Banknote } from "lucide-react";

const CATEGORY_CONFIG: Record<string, { icon: typeof Landmark; bg: string; color: string }> = {
  politics: { icon: Landmark, bg: "bg-yes/15", color: "text-yes" },
  economy: { icon: TrendingUp, bg: "bg-success/15", color: "text-success" },
  economics: { icon: TrendingUp, bg: "bg-success/15", color: "text-success" },
  sports: { icon: Trophy, bg: "bg-warning/15", color: "text-warning" },
  tech: { icon: Cpu, bg: "bg-[#A855F7]/15", color: "text-[#A855F7]" },
  finance: { icon: Banknote, bg: "bg-success/15", color: "text-success" },
  general: { icon: Globe, bg: "bg-muted-custom/15", color: "text-muted-custom" },
};

interface MarketIconProps {
  category?: string | null;
  /** "sm" = 32px (card), "md" = 40px (detail page), "lg" = 48px (hero) */
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function MarketIcon({ category, size = "md", className }: MarketIconProps) {
  const key = (category || "general").toLowerCase();
  const config = CATEGORY_CONFIG[key] || CATEGORY_CONFIG.general;
  const Icon = config.icon;

  const sizeClasses = {
    sm: "w-8 h-8 rounded-lg",
    md: "w-10 h-10 rounded-lg",
    lg: "w-12 h-12 rounded-lg",
  };

  const iconSizes = {
    sm: "w-4 h-4",
    md: "w-5 h-5",
    lg: "w-6 h-6",
  };

  return (
    <div
      className={cn(
        "flex items-center justify-center flex-shrink-0",
        sizeClasses[size],
        config.bg,
        className
      )}
    >
      <Icon className={cn(iconSizes[size], config.color)} />
    </div>
  );
}
