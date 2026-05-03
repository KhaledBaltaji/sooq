import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { HelpCollectionForm } from "@/components/admin/help-collection-form";

export default function CreateCollectionPage() {
  return (
    <div className="p-8 space-y-8">
      <Link
        href="/admin/help"
        className="inline-flex items-center gap-1.5 text-sm text-[#566166] hover:text-[#2a3439] transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Help center
      </Link>
      <h2 className="text-3xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
        New collection
      </h2>
      <HelpCollectionForm mode="create" />
    </div>
  );
}
