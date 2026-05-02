"use client";

/**
 * ShareKitModal — one-click sharing for commission branch owners.
 *
 * Provides three artifacts:
 *   1. Branded OG image preview (via /api/og/branch/[branchCode])
 *   2. Copy-to-clipboard messages for WhatsApp, X (English + Arabic)
 *   3. QR code (rendered via external api.qrserver.com — served over HTTPS,
 *      cached by browser). No extra npm dep; if the external service is down,
 *      the modal degrades gracefully to copy-link only.
 *
 * MENA-aware: WhatsApp is primary; X secondary; Arabic copy defaults are
 * RTL-ready.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface ShareKitModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchCode: string;
  branchName: string;
  /** Origin used to build absolute URLs (e.g., "https://sooq.exchange") */
  origin: string;
}

type Locale = "en" | "ar";
type Channel = "whatsapp" | "x";

function buildShareText(locale: Locale, branchName: string, url: string): string {
  if (locale === "ar") {
    return `انضم إلى ${branchName} على سوق. توقّع، اربح، واسحب في أي وقت.\n\n${url}`;
  }
  return `Join ${branchName} on SOOQ. Predict real-world outcomes, win real money, cash out anytime.\n\n${url}`;
}

function buildChannelUrl(channel: Channel, text: string): string {
  const encodedText = encodeURIComponent(text);
  switch (channel) {
    case "whatsapp":
      return `https://wa.me/?text=${encodedText}`;
    case "x":
      return `https://twitter.com/intent/tweet?text=${encodedText}`;
  }
}

export function ShareKitModal({
  open,
  onOpenChange,
  branchCode,
  branchName,
  origin,
}: ShareKitModalProps) {
  const [locale, setLocale] = useState<Locale>("en");
  const [copied, setCopied] = useState<"link" | Locale | null>(null);

  const branchUrl = `${origin}/b/${branchCode}`;
  const ogImageUrl = `${origin}/api/og/branch/${branchCode}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(branchUrl)}&margin=16`;
  const shareText = buildShareText(locale, branchName, branchUrl);

  const copyToClipboard = async (text: string, key: "link" | Locale) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard permission denied — silent fail; user can still select text */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Share your branch</DialogTitle>
          <DialogDescription>
            Copy a pre-written message, grab your QR code, or preview your branded card.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* OG preview */}
          <section>
            <h3 className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-2">
              Preview card
            </h3>
            <div className="relative aspect-[1200/630] w-full overflow-hidden rounded-lg bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={ogImageUrl}
                alt={`${branchName} share card`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
            <p className="text-xs text-[#566166] mt-2">
              This is what people see when your link is shared on WhatsApp, Telegram, or social media.
            </p>
          </section>

          {/* Direct link copy */}
          <section>
            <h3 className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-2">
              Your link
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={branchUrl}
                className="flex-1 border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm font-mono bg-[#f7f9fb]"
              />
              <button
                onClick={() => copyToClipboard(branchUrl, "link")}
                className="px-4 py-2.5 rounded-lg bg-[var(--yes,#2D8CFF)] text-white text-sm font-bold hover:opacity-90"
              >
                {copied === "link" ? "Copied!" : "Copy"}
              </button>
            </div>
          </section>

          {/* Language toggle + share text */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[10px] font-bold text-[#566166] uppercase tracking-widest">
                Pre-written message
              </h3>
              <div className="flex gap-1">
                {(["en", "ar"] as Locale[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLocale(l)}
                    className={`text-[11px] font-bold px-2 py-1 rounded transition-colors ${
                      locale === l
                        ? "bg-[#2a3439] text-white"
                        : "bg-[#f0f4f7] text-[#566166]"
                    }`}
                  >
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              readOnly
              value={shareText}
              dir={locale === "ar" ? "rtl" : "ltr"}
              rows={4}
              className="w-full border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm bg-[#f7f9fb] resize-none"
            />
            <div className="flex gap-2 mt-3 flex-wrap">
              <button
                onClick={() => copyToClipboard(shareText, locale)}
                className="flex-1 min-w-[120px] px-4 py-2.5 rounded-lg bg-[#2a3439] text-white text-sm font-bold hover:opacity-90"
              >
                {copied === locale ? "Copied!" : "Copy message"}
              </button>
              <a
                href={buildChannelUrl("whatsapp", shareText)}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2.5 rounded-lg bg-[#25D366] text-white text-sm font-bold hover:opacity-90"
              >
                WhatsApp
              </a>
              <a
                href={buildChannelUrl("x", shareText)}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2.5 rounded-lg bg-black text-white text-sm font-bold hover:opacity-90"
              >
                X
              </a>
            </div>
          </section>

          {/* QR code */}
          <section>
            <h3 className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-2">
              QR code
            </h3>
            <div className="flex items-center gap-4">
              <div className="w-32 h-32 border border-[#d9e4ea] rounded-lg overflow-hidden bg-white flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrUrl}
                  alt={`QR code for ${branchUrl}`}
                  width={128}
                  height={128}
                  loading="lazy"
                />
              </div>
              <div className="flex-1 space-y-2">
                <p className="text-sm text-[#566166]">
                  Print this on business cards or post in your shop. Scans send people straight to your branch.
                </p>
                <a
                  href={qrUrl}
                  download={`sooq-${branchCode}-qr.png`}
                  className="inline-block px-4 py-2 rounded-lg bg-[#2a3439] text-white text-sm font-bold hover:opacity-90"
                >
                  Download PNG
                </a>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
