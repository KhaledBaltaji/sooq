import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { MessageSquare, Headphones } from "lucide-react";
import { Breadcrumb } from "@/components/help/breadcrumb";
import { ArticleRenderer } from "@/components/help/article-renderer";
import { getHelpIcon } from "@/lib/help-utils";
import { getLocale, getTranslations } from "next-intl/server";
import { getSupportWhatsAppHref, isSupportWhatsAppConfigured } from "@/lib/support-whatsapp";

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string; articleSlug: string }>;
}) {
  const { slug, articleSlug } = await params;
  const locale = await getLocale();
  const t = await getTranslations("helpPage");
  const tSupport = await getTranslations("support");
  const supabase = await createClient();

  const { data: collection } = await supabase
    .from("help_collections")
    .select("id, title, slug")
    .eq("slug", slug)
    .eq("is_published", true)
    .single();

  if (!collection) notFound();

  const [{ data: allCollections }, { data: article }] = await Promise.all([
    supabase
      .from("help_collections")
      .select("id, title, slug, icon")
      .eq("is_published", true)
      .eq("locale", locale)
      .order("sort_order"),
    supabase
      .from("help_articles")
      .select("*")
      .eq("collection_id", collection.id)
      .eq("slug", articleSlug)
      .eq("is_published", true)
      .single(),
  ]);

  if (!article) notFound();

  const updatedDate = new Date(article.updated_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen pt-8 pb-24 px-4 md:px-8 max-w-[1200px] mx-auto">
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
        <div className="flex-1 min-w-0 max-w-3xl">
          <Breadcrumb
            items={[
              { label: t("title"), href: "/help" },
              { label: collection.title, href: `/help/${collection.slug}` },
              { label: article.title },
            ]}
          />

          {/* Article card */}
          <div className="bg-surface border border-border-custom rounded-xl p-6 md:p-8">
            <h1 className="font-satoshi text-2xl font-bold text-text">
              {article.title}
            </h1>
            <p className="text-xs text-muted-custom mt-2 mb-6">Updated {updatedDate}</p>

            <div className="prose-custom">
              <ArticleRenderer content={article.content} />
            </div>
          </div>

          {/* Still need help? */}
          {isSupportWhatsAppConfigured() && (
            <section className="mt-6 bg-surface border border-border-custom rounded-xl p-6 md:p-8 text-center">
              <h2 className="font-satoshi font-bold text-lg text-text mb-2">
                {t("stillNeedHelp")}
              </h2>
              <p className="font-dm-sans text-sm text-muted-custom mb-6 max-w-md mx-auto">
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
