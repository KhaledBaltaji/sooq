import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight, MessageSquare, Headphones } from "lucide-react";
import { getHelpIcon, extractPreview } from "@/lib/help-utils";
import { Breadcrumb } from "@/components/help/breadcrumb";
import { getLocale, getTranslations } from "next-intl/server";
import { getSupportWhatsAppHref, isSupportWhatsAppConfigured } from "@/lib/support-whatsapp";

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations("helpPage");
  const tSupport = await getTranslations("support");
  const supabase = await createClient();

  // Fetch current collection
  const { data: collection } = await supabase
    .from("help_collections")
    .select("*")
    .eq("slug", slug)
    .eq("is_published", true)
    .single();

  if (!collection) notFound();

  // Fetch all collections for sidebar + current collection's articles
  const [{ data: allCollections }, { data: articles }] = await Promise.all([
    supabase
      .from("help_collections")
      .select("id, title, slug, icon")
      .eq("is_published", true)
      .eq("locale", locale)
      .order("sort_order"),
    supabase
      .from("help_articles")
      .select("id, title, slug, content")
      .eq("collection_id", collection.id)
      .eq("is_published", true)
      .order("sort_order"),
  ]);

  const Icon = getHelpIcon(collection.icon);

  return (
    <div className="min-h-screen pt-8 pb-24 px-4 md:px-8 max-w-[1200px] mx-auto">
      {/* Sidebar + Main content */}
      <div className="flex gap-8">
        {/* Sidebar — desktop only */}
        <aside className="hidden lg:block w-56 flex-shrink-0">
          <div className="sticky top-24">
            <Link href="/help" className="block mb-1">
              <h2 className="font-satoshi text-lg font-bold text-text">
                {t("title")}
              </h2>
            </Link>
            <p className="font-dm-sans text-xs text-muted-custom mb-6">
              {t("searchArticles")}
            </p>

            <nav className="space-y-1">
              {(allCollections || []).map((c: any) => {
                const CIcon = getHelpIcon(c.icon);
                const isActive = c.slug === slug;
                return (
                  <Link
                    key={c.id}
                    href={`/help/${c.slug}`}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-yes/10 text-yes"
                        : "text-muted-custom hover:bg-elevated hover:text-text"
                    }`}
                  >
                    <CIcon className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-yes" : "text-dim"}`} />
                    <span>{c.title}</span>
                  </Link>
                );
              })}
            </nav>

            {/* Contact Support */}
            {isSupportWhatsAppConfigured() && (
              <div className="mt-8 pt-6 border-t border-border-custom">
                <a
                  href={getSupportWhatsAppHref(tSupport("whatsAppDefaultMessage"))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-custom hover:bg-elevated hover:text-text transition-colors"
                >
                  <Headphones className="w-4 h-4 text-dim" />
                  <span>{tSupport("contactWhatsApp")}</span>
                </a>
              </div>
            )}
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <Breadcrumb
            items={[
              { label: t("title"), href: "/help" },
              { label: collection.title },
            ]}
          />

          {/* Collection header */}
          <div className="mb-8">
            <div className="flex items-center gap-4 mb-2">
              <div className="w-12 h-12 rounded-xl bg-yes/10 flex items-center justify-center">
                <Icon className="w-6 h-6 text-yes" />
              </div>
              <div>
                <h1 className="font-satoshi text-2xl font-bold text-text">
                  {collection.title}
                </h1>
                {collection.description && (
                  <p className="font-dm-sans text-sm text-muted-custom mt-0.5">
                    {collection.description}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Article cards */}
          <div className="space-y-3">
            {(articles || []).map((article: any) => (
              <Link
                key={article.id}
                href={`/help/${slug}/${article.slug}`}
                className="block bg-surface border border-border-custom rounded-xl p-5 hover:bg-elevated transition-colors group"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-satoshi font-bold text-base text-text mb-1.5 group-hover:text-yes transition-colors">
                      {article.title}
                    </h3>
                    {article.content && (
                      <p className="font-dm-sans text-sm text-text/50 leading-relaxed">
                        {extractPreview(article.content)}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="w-5 h-5 text-dim group-hover:text-yes transition-colors flex-shrink-0 mt-0.5 rtl:scale-x-[-1]" />
                </div>
              </Link>
            ))}

            {(articles || []).length === 0 && (
              <div className="bg-surface rounded-xl p-8 text-center">
                <p className="text-sm text-muted-custom">{t("noArticles")}</p>
              </div>
            )}
          </div>

          {/* Still need help? */}
          {isSupportWhatsAppConfigured() && (
            <section className="mt-16 pt-8 border-t border-border-custom text-center">
              <h2 className="font-satoshi font-bold text-xl text-text mb-2">
                {t("stillNeedHelp")}
              </h2>
              <p className="font-dm-sans text-sm text-muted-custom mb-8 max-w-md mx-auto">
                {t("stillNeedHelpDesc")}
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <a
                  href={getSupportWhatsAppHref(tSupport("whatsAppDefaultMessage"))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-yes text-white px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 hover:shadow-[0_0_20px_rgba(45,140,255,0.15)] transition-all"
                >
                  <MessageSquare className="w-4 h-4" />
                  {tSupport("contactWhatsApp")}
                </a>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
