"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Search, ChevronRight } from "lucide-react";
import { useSupabase } from "@/components/providers/supabase-provider";

interface SearchResult {
  id: string;
  title: string;
  slug: string;
  collection: { slug: string; title: string } | null;
}

export function HelpSearch() {
  const supabase = useSupabase();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = (value: string) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!value.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }

    timerRef.current = setTimeout(async () => {
      const { data, error } = await supabase
        .from("help_articles")
        .select("id, title, slug, collection:help_collections(slug, title)")
        .or(`title.ilike.%${value}%,content.ilike.%${value}%`)
        .eq("is_published", true)
        .limit(8);

      if (error) {
        console.error("Help search failed:", error.message);
        return;
      }
      if (data) {
        setResults(data as unknown as SearchResult[]);
        setOpen(true);
      }
    }, 300);
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-2xl mx-auto">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-custom w-4 h-4" />
        <input
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search for articles, guides, or help topics..."
          className="w-full h-12 bg-surface border border-border-custom rounded-lg ps-12 pe-4 text-sm font-dm-sans text-text placeholder:text-muted focus:outline-none focus:border-yes focus:ring-1 focus:ring-yes transition-all"
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border-custom rounded-xl shadow-lg z-20 overflow-hidden py-1">
          {results.map((r) => (
            <Link
              key={r.id}
              href={`/help/${r.collection?.slug || "unknown"}/${r.slug}`}
              onClick={() => { setOpen(false); setQuery(""); }}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-elevated transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text truncate">{r.title}</p>
                {r.collection?.title && (
                  <p className="text-xs text-muted-custom">{r.collection.title}</p>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-dim group-hover:text-muted-custom transition-colors flex-shrink-0 rtl:scale-x-[-1]" />
            </Link>
          ))}
        </div>
      )}

      {open && query && results.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border-custom rounded-xl shadow-lg z-20 px-4 py-6">
          <p className="text-sm text-muted-custom text-center">No articles found</p>
        </div>
      )}
    </div>
  );
}
