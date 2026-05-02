"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface MarketKeywordsEditorProps {
  marketId: string;
  initialKeywords: string[];
}

export function MarketKeywordsEditor({ marketId, initialKeywords }: MarketKeywordsEditorProps) {
  const t = useTranslations("toast");
  const [keywords, setKeywords] = useState<string[]>(initialKeywords);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  const addKeyword = () => {
    const kw = input.trim().toLowerCase();
    if (!kw) return;
    if (keywords.includes(kw)) {
      toast.error(t("keywordExists"));
      return;
    }
    const updated = [...keywords, kw];
    setKeywords(updated);
    setInput("");
    saveKeywords(updated);
  };

  const removeKeyword = (kw: string) => {
    const updated = keywords.filter((k) => k !== kw);
    setKeywords(updated);
    saveKeywords(updated);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addKeyword();
    }
  };

  const saveKeywords = async (newKeywords: string[]) => {
    setSaving(true);
    const { error } = await supabase
      .from("markets")
      .update({ keywords: newKeywords })
      .eq("id", marketId);

    if (error) {
      toast.error(t("failedToSave"), { description: error.message });
    } else {
      toast.success(t("keywordsUpdated"));
    }
    setSaving(false);
  };

  return (
    <div className="bg-white p-8 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
      <div className="flex items-center gap-2 mb-4">
        <span className="material-symbols-outlined text-[#566166]">rss_feed</span>
        <h4 className="font-bold tracking-tight text-[#566166]">News Feed Keywords</h4>
        {saving && (
          <span className="text-[10px] text-[#a9b4b9] font-medium ml-2">Saving...</span>
        )}
      </div>
      <p className="text-xs text-[#566166] mb-4">
        Keywords match RSS news articles to this market. Articles containing any keyword in their title will appear linked to this market in the live feed.
      </p>

      {/* Keyword pills */}
      <div className="flex flex-wrap gap-2 mb-4 min-h-[32px]">
        {keywords.length === 0 && (
          <span className="text-xs text-[#a9b4b9] italic">No keywords set — general MENA news will show instead</span>
        )}
        {keywords.map((kw) => (
          <span
            key={kw}
            className="inline-flex items-center gap-1.5 bg-[#dae2fd] text-[#4a5167] text-xs font-bold px-3 py-1 rounded-full"
          >
            {kw}
            <button
              onClick={() => removeKeyword(kw)}
              className="hover:text-[var(--error)] transition-colors cursor-pointer"
              aria-label={`Remove ${kw}`}
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </span>
        ))}
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-[#f0f4f7] border-none rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:bg-white transition-all placeholder:text-[#a9b4b9]"
          placeholder="Type a keyword and press Enter"
        />
        <button
          onClick={addKeyword}
          disabled={!input.trim()}
          className="px-4 py-2.5 bg-[var(--yes)] text-white text-sm font-bold rounded-lg hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          Add
        </button>
      </div>
    </div>
  );
}
