"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex items-center justify-center py-20 px-8">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
          <span className="material-symbols-outlined text-red-500 text-2xl">error</span>
        </div>
        <h2 className="text-lg font-extrabold text-[#2a3439] font-[family-name:var(--font-manrope)] mb-2">
          Admin Error
        </h2>
        <p className="text-sm text-[#566166] mb-6 max-w-[280px] mx-auto">
          {error.message || "Failed to load admin data. Check your connection."}
        </p>
        <button
          onClick={reset}
          className="px-6 py-2.5 bg-[var(--yes)] text-white font-bold rounded-lg hover:opacity-90 transition-all text-sm flex items-center gap-2 mx-auto"
        >
          <span className="material-symbols-outlined text-sm">refresh</span>
          Retry
        </button>
      </div>
    </div>
  );
}
