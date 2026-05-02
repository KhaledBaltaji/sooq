"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronUp, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface AboutMarketProps {
  description: string | null;
  className?: string;
}

export function AboutMarket({ description, className }: AboutMarketProps) {
  const t = useTranslations("market");
  const [expanded, setExpanded] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);

  const text = description || t("defaultResolutionDesc");

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [text]);

  return (
    <div className={cn("bg-surface rounded-lg border border-border-custom/50", className)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex justify-between items-center p-5 hover:bg-elevated transition-colors cursor-pointer rounded-lg"
      >
        <span className="font-satoshi font-medium text-lg text-text">{t("aboutThisMarket")}</span>
        <ChevronUp
          className={cn(
            "w-5 h-5 text-muted-custom transition-transform duration-300 ease-in-out",
            !expanded && "rotate-180"
          )}
        />
      </button>
      <div
        ref={contentRef}
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: expanded ? contentHeight ?? 500 : 0,
          opacity: expanded ? 1 : 0,
        }}
      >
        <div className="px-5 pb-5 space-y-4">
          <p className="text-muted-custom text-base leading-relaxed font-dm-sans">
            {text}
          </p>
          <div className="pt-4 border-t border-border-custom flex items-center gap-3">
            <Info className="w-4 h-4 text-yes" />
            <span className="text-xs text-muted-custom">
              {t("resolutionInfo")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
