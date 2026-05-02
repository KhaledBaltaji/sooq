"use client";

import { useMemo } from "react";
import { slugify } from "@/lib/help-utils";

interface TocItem {
  text: string;
  id: string;
  level: number;
}

function extractHeadings(markdown: string): TocItem[] {
  const headings: TocItem[] = [];
  const lines = markdown.split("\n");
  for (const line of lines) {
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (match) {
      headings.push({
        text: match[2].trim(),
        id: slugify(match[2].trim()),
        level: match[1].length,
      });
    }
  }
  return headings;
}

export function ArticleToc({ content }: { content: string }) {
  const headings = useMemo(() => extractHeadings(content), [content]);

  if (headings.length < 2) return null;

  return (
    <nav className="sticky top-24 space-y-xs">
      {headings.map((h) => (
        <a
          key={h.id}
          href={`#${h.id}`}
          className={`block text-sm font-dm-sans text-muted-custom hover:text-text transition-colors ${
            h.level === 3 ? "ps-md" : ""
          }`}
        >
          {h.text}
        </a>
      ))}
    </nav>
  );
}
