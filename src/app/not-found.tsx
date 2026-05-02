import Link from "next/link";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { persistToSystemLogs } from "@/lib/logger";

export default async function NotFound() {
  const headerList = await headers();
  const url = headerList.get("x-invoke-path") || headerList.get("referer") || "unknown";
  const t = await getTranslations("errors");

  persistToSystemLogs("error", `404 Not Found: ${url}`, {
    source: "http/404",
    path: url,
  });

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="w-16 h-16 rounded-full bg-[#f0f4f7] flex items-center justify-center">
        <span className="material-symbols-outlined text-3xl text-[#566166]">search_off</span>
      </div>
      <h2 className="text-xl font-bold text-[#2a3439] font-[family-name:var(--font-dm-sans)]">
        {t("pageNotFound")}
      </h2>
      <p className="text-sm text-[#566166] max-w-sm">
        {t("pageNotFoundDesc")}
      </p>
      <Link
        href="/"
        className="mt-2 px-6 py-2.5 bg-[var(--yes)] text-white font-semibold rounded-lg text-sm hover:opacity-90 transition-opacity"
      >
        {t("goHome")}
      </Link>
    </div>
  );
}
