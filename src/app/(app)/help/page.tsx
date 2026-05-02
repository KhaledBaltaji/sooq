import { createClient } from "@/lib/supabase/server";
import { getLocale, getTranslations } from "next-intl/server";
import { MessageSquare } from "lucide-react";
import { CollectionCard } from "@/components/help/collection-card";
import { HelpSearch } from "@/components/help/help-search";
import type { HelpCollectionWithCount } from "@/types/help";
import { getSupportWhatsAppHref, isSupportWhatsAppConfigured } from "@/lib/support-whatsapp";

export default async function HelpPage() {
  const locale = await getLocale();
  const t = await getTranslations("helpPage");
  const tSupport = await getTranslations("support");
  const supabase = await createClient();

  const { data: raw, error: queryError } = await supabase
    .from("help_collections")
    .select("*, help_articles(count)")
    .eq("is_published", true)
    .eq("locale", locale)
    .order("sort_order");

  if (queryError) {
    console.error("Failed to fetch help collections:", queryError.message);
  }

  const collections: HelpCollectionWithCount[] = (raw || []).map((c: any) => ({
    ...c,
    article_count: c.help_articles?.[0]?.count || 0,
  }));

  return (
    <div className="min-h-screen pt-12 pb-24 px-md max-w-[1200px] mx-auto">
      {/* Hero */}
      <section className="flex flex-col items-center text-center mb-16">
        <h1 className="font-satoshi text-4xl md:text-5xl font-black text-text tracking-tight mb-8">
          {t("title")}
        </h1>
        <HelpSearch />
      </section>

      {/* Collection Grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {collections.map((c) => (
          <CollectionCard key={c.id} collection={c} />
        ))}
      </section>

      {collections.length === 0 && (
        <p className="text-center text-muted-custom mt-lg">
          {t("noArticles")}
        </p>
      )}

      {/* Support CTA */}
      <section className="mt-24 bg-elevated rounded-2xl p-8 md:p-12 text-center border border-border-custom/50">
        <h2 className="font-satoshi font-bold text-2xl md:text-3xl text-text mb-4">
          {t("supportTitle")}
        </h2>
        <p className="font-dm-sans text-sm text-muted-custom mb-10 max-w-lg mx-auto leading-relaxed">
          {t("supportDescription")}
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          {isSupportWhatsAppConfigured() && (
            <a
              href={getSupportWhatsAppHref(tSupport("whatsAppDefaultMessage"))}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-yes text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:shadow-[0_0_20px_rgba(45,140,255,0.15)] transition-all"
            >
              <MessageSquare className="w-5 h-5" />
              {tSupport("contactWhatsApp")}
            </a>
          )}
        </div>
      </section>
    </div>
  );
}
