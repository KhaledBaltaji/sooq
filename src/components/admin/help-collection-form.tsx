"use client";

// Shared form for create + edit of a help collection. POST/PATCH against
// /api/admin/help/collections.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HELP_ICON_OPTIONS, getHelpIcon, slugify } from "@/lib/help-utils";

export interface HelpCollectionFormValue {
  id?: string;
  slug?: string;
  title?: string;
  description?: string | null;
  icon?: string;
  locale?: string;
  sort_order?: number;
  is_published?: boolean;
}

export function HelpCollectionForm({
  initial,
  mode,
}: {
  initial?: HelpCollectionFormValue;
  mode: "create" | "edit";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "help-circle");
  const [locale, setLocale] = useState(initial?.locale ?? "en");
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
      slug: slug.trim() || slugify(title),
      title: title.trim(),
      description: description.trim() || null,
      icon,
      locale,
      sort_order: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
      is_published: isPublished,
    };
    const url =
      mode === "create"
        ? "/api/admin/help/collections"
        : `/api/admin/help/collections/${initial?.id}`;
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
      router.push("/admin/help");
      router.refresh();
    });
  };

  const Icon = getHelpIcon(icon);

  return (
    <form onSubmit={onSubmit} className="space-y-6 max-w-2xl">
      <Field label="Title" htmlFor="title">
        <input
          id="title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-white border border-[#e9ecef] rounded-lg px-3 py-2 text-sm focus:border-[#2d6cdf] outline-none"
          placeholder="Getting Started"
        />
      </Field>

      <Field label="Slug" htmlFor="slug" hint="URL path. Lowercase, hyphens only.">
        <input
          id="slug"
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          onBlur={() => !slug && setSlug(slugify(title))}
          className="w-full bg-white border border-[#e9ecef] rounded-lg px-3 py-2 text-sm focus:border-[#2d6cdf] outline-none font-mono"
          placeholder="getting-started"
        />
      </Field>

      <Field label="Description" htmlFor="description">
        <textarea
          id="description"
          value={description ?? ""}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full bg-white border border-[#e9ecef] rounded-lg px-3 py-2 text-sm focus:border-[#2d6cdf] outline-none resize-y"
          placeholder="Short summary shown on the collection card."
        />
      </Field>

      <Field label="Icon" htmlFor="icon">
        <div className="flex items-center gap-3">
          <select
            id="icon"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            className="bg-white border border-[#e9ecef] rounded-lg px-3 py-2 text-sm focus:border-[#2d6cdf] outline-none"
          >
            {HELP_ICON_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <div className="w-10 h-10 rounded-lg bg-[#dae2fd] flex items-center justify-center">
            <Icon className="w-5 h-5 text-[#4a5167]" />
          </div>
        </div>
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Locale" htmlFor="locale">
          <select
            id="locale"
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            className="w-full bg-white border border-[#e9ecef] rounded-lg px-3 py-2 text-sm"
          >
            <option value="en">English</option>
            <option value="ar">Arabic</option>
          </select>
        </Field>
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
          disabled={pending}
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
