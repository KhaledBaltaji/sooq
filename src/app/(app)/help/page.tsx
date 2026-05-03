// W10 help center landing — collection grid + WhatsApp CTA. Server-side
// fetches the locale-filtered collections via Drizzle (no client query
// roundtrip on first paint). Replaces the W10 stub with the full
// collection-card layout from prediction-market.

import { and, asc, eq, sql } from "drizzle-orm";
import { MessageSquare } from "lucide-react";
import { getLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { helpCollections, helpArticles } from "@/lib/db/schema";
import { CollectionCard } from "@/components/help/collection-card";
import {
  getSupportWhatsAppHref,
  isSupportWhatsAppConfigured,
} from "@/lib/support-whatsapp";
import type { HelpCollectionWithCount } from "@/types/help";

export const dynamic = "force-dynamic";

export default async function HelpPage() {
  const locale = await getLocale();

  const rows = await db
    .select({
      id: helpCollections.id,
      slug: helpCollections.slug,
      title: helpCollections.title,
      description: helpCollections.description,
      icon: helpCollections.icon,
      locale: helpCollections.locale,
      sortOrder: helpCollections.sortOrder,
      isPublished: helpCollections.isPublished,
      createdAt: helpCollections.createdAt,
      updatedAt: helpCollections.updatedAt,
      articleCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${helpArticles}
        WHERE ${helpArticles.collectionId} = ${helpCollections.id}
          AND ${helpArticles.isPublished} = TRUE
      )`,
    })
    .from(helpCollections)
    .where(
      and(
        eq(helpCollections.isPublished, true),
        eq(helpCollections.locale, locale)
      )
    )
    .orderBy(asc(helpCollections.sortOrder));

  const collections: HelpCollectionWithCount[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    icon: r.icon,
    locale: r.locale,
    sort_order: r.sortOrder,
    is_published: r.isPublished,
    article_count: Number(r.articleCount ?? 0),
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  }));

  const supportConfigured = isSupportWhatsAppConfigured();
  const supportHref = getSupportWhatsAppHref(
    "Hi, I need help with my Sooq account."
  );

  return (
    <main className="min-h-screen pt-12 pb-24 px-md max-w-[1200px] mx-auto">
      <section className="flex flex-col items-center text-center mb-16">
        <h1 className="font-satoshi text-4xl md:text-5xl font-black text-text tracking-tight mb-4">
          How can we help?
        </h1>
        <p className="text-sm text-muted-custom max-w-md">
          Browse the topics below or message us directly on WhatsApp.
        </p>
      </section>

      {collections.length > 0 ? (
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {collections.map((c) => (
            <CollectionCard key={c.id} collection={c} />
          ))}
        </section>
      ) : (
        <p className="text-center text-muted-custom mt-12">
          The help center is being prepared. Check back soon, or message us
          on WhatsApp in the meantime.
        </p>
      )}

      {supportConfigured && (
        <section className="mt-24 bg-elevated rounded-2xl p-8 md:p-12 text-center border border-border-custom/50">
          <h2 className="font-satoshi font-bold text-2xl md:text-3xl text-text mb-4">
            Still stuck?
          </h2>
          <p className="font-dm-sans text-sm text-muted-custom mb-10 max-w-lg mx-auto leading-relaxed">
            Message us on WhatsApp. We respond within minutes during business
            hours.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <a
              href={supportHref}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-yes text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:shadow-[0_0_20px_rgba(45,140,255,0.15)] transition-all"
            >
              <MessageSquare className="w-5 h-5" />
              Contact us on WhatsApp
            </a>
          </div>
        </section>
      )}
    </main>
  );
}
