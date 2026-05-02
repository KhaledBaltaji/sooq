"use client";

import Link from "next/link";
import { Flame } from "lucide-react";

interface NewsItem {
  id: string;
  tag: string;
  tagColor: string;
  headline: string;
  source: string;
  image: string;
  href: string;
}

const NEWS_ITEMS: NewsItem[] = [
  {
    id: "1",
    tag: "BREAKING",
    tagColor: "text-no bg-no/10",
    headline: "Lebanon Parliament Delays Election Date Again",
    source: "Reuters",
    image: "https://placehold.co/80x80/1A1A1F/2D8CFF?text=LB",
    href: "#",
  },
  {
    id: "2",
    tag: "ECONOMY",
    tagColor: "text-yes bg-yes/10",
    headline: "Saudi Arabia Announces NEOM Phase 1 Timeline Update",
    source: "Bloomberg",
    image: "https://placehold.co/80x80/1A1A1F/00E87B?text=SA",
    href: "#",
  },
  {
    id: "3",
    tag: "POLITICS",
    tagColor: "text-warning bg-warning/10",
    headline: "UAE Considers New Tax Framework for 2030",
    source: "Al Jazeera",
    image: "https://placehold.co/80x80/1A1A1F/FFB347?text=AE",
    href: "#",
  },
];

export function TrendingSidebar() {
  return (
    <div className="bg-surface rounded-lg p-5 border border-border-custom/30 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-no" />
          <h3 className="font-satoshi font-black text-xs uppercase tracking-widest text-text">
            News
          </h3>
        </div>
      </div>

      {/* News items */}
      <div className="space-y-4">
        {NEWS_ITEMS.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className="flex gap-3 group cursor-pointer"
          >
            <img
              src={item.image}
              alt=""
              className="w-16 h-16 rounded-lg object-cover flex-shrink-0 bg-elevated"
            />
            <div className="flex flex-col gap-1 min-w-0">
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded w-fit uppercase tracking-wider ${item.tagColor}`}>
                {item.tag}
              </span>
              <span className="text-[11px] font-bold text-text group-hover:text-yes transition-colors line-clamp-2 leading-snug">
                {item.headline}
              </span>
              <span className="text-[9px] text-muted-custom uppercase tracking-wider">
                {item.source}
              </span>
            </div>
          </Link>
        ))}
      </div>

    </div>
  );
}
