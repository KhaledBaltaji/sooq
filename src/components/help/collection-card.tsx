import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getHelpIcon } from "@/lib/help-utils";
import type { HelpCollectionWithCount } from "@/types/help";

export function CollectionCard({ collection }: { collection: HelpCollectionWithCount }) {
  const Icon = getHelpIcon(collection.icon);

  return (
    <Link
      href={`/help/${collection.slug}`}
      className="block bg-surface border border-border-custom p-6 rounded-xl hover:bg-elevated transition-all duration-200 group cursor-pointer"
    >
      <div className="w-10 h-10 rounded-lg bg-yes/10 flex items-center justify-center mb-6">
        <Icon className="w-5 h-5 text-yes" />
      </div>
      <h3 className="font-satoshi text-lg font-bold text-text mb-2">
        {collection.title}
      </h3>
      {collection.description && (
        <p className="font-dm-sans text-sm text-muted-custom leading-relaxed mb-6 line-clamp-2">
          {collection.description}
        </p>
      )}
      <div className="flex items-center justify-between text-muted-custom text-xs font-medium">
        <span>
          {collection.article_count} {collection.article_count === 1 ? "article" : "articles"}
        </span>
        <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform rtl:scale-x-[-1]" />
      </div>
    </Link>
  );
}
