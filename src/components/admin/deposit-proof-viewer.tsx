"use client";

// W7 cutover: signed URLs come from /api/storage/view-url backed by S3.

import { useState, useEffect } from "react";
import { X, Loader2, ImageIcon } from "lucide-react";

interface DepositProofViewerProps {
  /** S3 object key, e.g. "{userId}/{uuid}.jpg" */
  path: string;
}

export function DepositProofViewer({ path }: DepositProofViewerProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchUrl() {
      setLoading(true);
      try {
        const res = await fetch(`/api/storage/view-url?key=${encodeURIComponent(path)}`);
        if (!res.ok) throw new Error("Failed to load receipt");
        const data = (await res.json()) as { url: string };
        if (!cancelled && data.url) {
          setSignedUrl(data.url);
        }
      } catch (err) {
        console.error("Failed to get signed URL:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchUrl();
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (loading) {
    return (
      <div className="w-10 h-10 rounded-lg bg-[#f0f4f7] flex items-center justify-center">
        <Loader2 className="w-4 h-4 text-[#a9b4b9] animate-spin" />
      </div>
    );
  }

  if (!signedUrl) {
    return (
      <div
        className="w-10 h-10 rounded-lg bg-[#f0f4f7] flex items-center justify-center"
        title="Receipt unavailable"
      >
        <ImageIcon className="w-4 h-4 text-[#a9b4b9]" />
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setLightbox(true)}
        className="w-10 h-10 rounded-lg overflow-hidden border border-[#a9b4b9]/20 hover:border-[var(--yes)]/50 transition-all flex-shrink-0"
        title="View receipt"
      >
        <img src={signedUrl} alt="Receipt" className="w-full h-full object-cover" />
      </button>

      {lightbox && (
        <div
          className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLightbox(false)}
        >
          <button
            onClick={() => setLightbox(false)}
            className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 z-10"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={signedUrl}
            alt="Deposit receipt"
            className="max-w-full max-h-[85vh] rounded-xl shadow-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
