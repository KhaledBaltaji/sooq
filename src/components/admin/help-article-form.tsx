"use client";

// Shared form for create + edit of a help article. POST/PATCH against
// /api/admin/help/articles.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { slugify } from "@/lib/help-utils";

export interface HelpArticleFormValue {
  id?: string;
  collection_id?: string;
  slug?: string;
  title?: string;
  content?: string;
  sort_order?: number;
  is_published?: boolean;
}

export interface HelpArticleFormCollection {
  id: string;
  title: string;
  slug: string;
}

export function HelpArticleForm({
  initial,
  mode,
  collections,
  defaultCollectionId,
}: {
  initial?: HelpArticleFormValue;
  mode: "create" | "edit";
  collections: HelpArticleFormCollection[];
  defaultCollectionId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const [collectionId, setCollectionId] = useState(
    initial?.collection_id ?? defaultCollectionId ?? collections[0]?.id ?? ""
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [sortOrder, setSortOrder] = useState(
    typeof initial?.sort_order === "number" ? String(initial.sort_order) : "0"
  );
  const [isPublished, setIsPublished] = useState(
    initial?.is_published ?? true
  );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const payload = {
      collection_id: collectionId,
      slug: slug.trim() || slugify(title),
      title: title.trim(),
      content,
      sort_order: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
      is_published: isPublished,
    };
    const url =
      mode === "create"
        ? "/api/admin/help/articles"
        : `/api/admin/help/articles/${initial?.id}`;
    const method = mode === "create" ? "POST" : "PATCH";

    startTransition(async () => {
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setErr(body.error ?? `Failed (${r.status})`);
        return;
      }
      // After save, route back to the parent collection's edit page so admin
      // can keep stacking articles in the same group.
      const parent = collections.find((c) => c.id === collectionId);
      if (parent) {
        router.push(`/admin/help/collections/${parent.id}/edit`);
      } else {
        router.push("/admin/help");
      }
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6 max-w-3xl">
      <Field label="Collection" htmlFor="collection_id">
        <select
          id="collection_id"
          value={collectionId}
          onChange={(e) => setCollectionId(e.target.value)}
          className="w-full bg-white border border-[#e9ecef] rounded-lg px-3 py-2 text-sm"
        >
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} (/{c.slug})
            </option>
          ))}
        </select>
      </Field>

      <Field label="Title" htmlFor="title">
        <input
          id="title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-white border border-[#e9ecef] rounded-lg px-3 py-2 text-sm focus:border-[#2d6cdf] outline-none"
          placeholder="What is Sooq Speed?"
        />
      </Field>

      <Field label="Slug" htmlFor="slug" hint="URL slug. Auto-generated from title.">
        <input
          id="slug"
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          onBlur={() => !slug && setSlug(slugify(title))}
          className="w-full bg-white border border-[#e9ecef] rounded-lg px-3 py-2 text-sm font-mono"
          placeholder="what-is-sooq-speed"
        />
      </Field>

      <Field label="Content" htmlFor="content" hint="Plain text or markdown. Renders preserving line breaks.">
        <textarea
          id="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={16}
          className="w-full bg-white border border-[#e9ecef] rounded-lg px-3 py-2 text-sm font-mono focus:border-[#2d6cdf] outline-none resize-y"
          placeholder="Write the answer here. Use blank lines to separate paragraphs."
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Sort order" htmlFor="sort_order">
          <input
            id="sort_order"
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="w-full bg-white border border-[#e9ecef] rounded-lg px-3 py-2 text-sm font-mono"
          />
        </Field>
        <Field label="Status" htmlFor="is_published">
          <label className="flex items-center gap-2 text-sm py-2">
            <input
              id="is_published"
              type="checkbox"
              checked={isPublished}
              onChange={(e) => setIsPublished(e.target.checked)}
            />
            Published
          </label>
        </Field>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={pending || !collectionId}
          className="bg-[#2d6cdf] hover:bg-[#2d6cdf]/90 text-white px-6 py-2.5 rounded-lg font-semibold disabled:opacity-50"
        >
          {pending ? "Saving…" : mode === "create" ? "Create" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="text-[#566166] hover:text-[#2a3439] px-4 py-2 rounded-lg"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="block text-xs font-bold uppercase tracking-wider text-[#566166] mb-1.5">
        {label}
      </span>
      {children}
      {hint && (
        <span className="block text-xs text-[#717c82] mt-1.5">{hint}</span>
      )}
    </label>
  );
}
