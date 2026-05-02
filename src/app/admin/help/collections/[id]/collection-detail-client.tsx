"use client";

import { useState } from "react";
import Link from "next/link";
import { EditCollectionDialog } from "@/components/admin/edit-collection-dialog";
import { getHelpIcon } from "@/lib/help-utils";

interface CollectionDetailClientProps {
  collection: {
    id: string;
    title: string;
    slug: string;
    description: string | null;
    icon: string;
    sort_order: number;
    is_published: boolean;
  };
  collectionId: string;
}

export function CollectionDetailClient({ collection, collectionId }: CollectionDetailClientProps) {
  const [editOpen, setEditOpen] = useState(false);
  const Icon = getHelpIcon(collection.icon);

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-[#dae2fd] rounded-xl flex items-center justify-center">
              <Icon className="w-5 h-5 text-[#4a5167]" />
            </div>
            <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
              {collection.title}
            </h2>
          </div>
          {collection.description && (
            <p className="text-[#566166] mt-1 max-w-lg">{collection.description}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setEditOpen(true)}
            className="px-5 py-3 rounded-lg text-sm font-semibold text-[#2a3439] bg-white border border-[#e8eff3] hover:bg-[#e8eff3] transition-all flex items-center gap-2 shadow-sm"
          >
            <span className="material-symbols-outlined text-lg">edit</span>
            Edit Collection
          </button>
          <Link
            href={`/admin/help/articles/create?collection=${collectionId}`}
            className="bg-[var(--yes)] hover:bg-[var(--yes)]/90 text-white px-6 py-3 rounded-lg flex items-center gap-2 font-semibold shadow-sm transition-all active:scale-95"
          >
            <span className="material-symbols-outlined text-lg">add</span>
            New Article
          </Link>
        </div>
      </div>

      <EditCollectionDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        collection={collection}
      />
    </>
  );
}
