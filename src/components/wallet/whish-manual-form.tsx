"use client";

import { useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "@/lib/auth/hooks";
import { Button } from "@/components/ui/button";
import { WHISH_DEPOSIT_NUMBERS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowLeft,
  Upload,
  Check,
  Loader2,
  Phone,
} from "lucide-react";
import Image from "next/image";

type FormStatus = "idle" | "uploading" | "submitting" | "success" | "error";

interface WhishManualFormProps {
  onSuccess?: () => void;
  onBack?: () => void;
  /** true = compact layout inside modal */
  compact?: boolean;
}

export function WhishManualForm({
  onSuccess,
  onBack,
  compact = false,
}: WhishManualFormProps) {
  const { user } = useSession();
  const t = useTranslations("wallet");
  const tc = useTranslations("common");
  const tt = useTranslations("toast");

  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<FormStatus>("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSubmit = status === "idle" && !!proofFile;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate type. Some browsers/devices report 'image/jpg' for JPEG files
    // (notably older mobile browsers). Accept both — we normalize on upload.
    if (!["image/jpeg", "image/jpg", "image/png"].includes(file.type)) {
      toast.error(t("invalidFileType"));
      return;
    }

    // Validate size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t("fileTooLarge"));
      return;
    }

    setProofFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setProofPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!canSubmit || !user || !proofFile) return;

    try {
      // Step 1: Upload proof image directly to S3 via presigned PUT URL.
      setStatus("uploading");
      const ext = proofFile.name.split(".").pop()?.toLowerCase() || "jpg";
      const normalizedType =
        proofFile.type === "image/jpg" ? "image/jpeg" : proofFile.type;

      const urlRes = await fetch("/api/storage/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content_type: normalizedType, ext }),
      });
      if (!urlRes.ok) {
        const data = (await urlRes.json().catch(() => ({}))) as { error?: string };
        console.error("[whish-manual] presign failed", data);
        toast.error(tt("receiptUploadFailed"));
        setStatus("idle");
        return;
      }
      const { url, key } = (await urlRes.json()) as { url: string; key: string };

      const putRes = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": normalizedType },
        body: proofFile,
      });
      if (!putRes.ok) {
        console.error("[whish-manual] S3 PUT failed", putRes.status);
        toast.error(tt("receiptUploadFailed"));
        setStatus("idle");
        return;
      }

      // Step 2: Submit manual deposit row.
      setStatus("submitting");
      const submitRes = await fetch("/api/deposit/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proof_key: key }),
      });
      if (!submitRes.ok) {
        const data = (await submitRes.json().catch(() => ({}))) as { error?: string };
        console.error("[whish-manual] submit failed", data);
        toast.error(tt("depositSubmitFailed"));
        setStatus("idle");
        return;
      }

      setStatus("success");
      onSuccess?.();
    } catch (err) {
      console.error("[whish-manual] handleSubmit threw", err);
      toast.error(tt("depositSubmitFailed"));
      setStatus("idle");
    }
  };

  // --- Success state ---
  if (status === "success") {
    return (
      <div className="relative">
        {compact && onBack && (
          <button
            onClick={onBack}
            className="absolute top-0 left-0 text-muted-custom hover:text-text transition-colors w-10 h-10 flex items-center justify-center rounded-full hover:bg-elevated/50"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <div className="text-center py-12 space-y-4">
          <div className="w-16 h-16 mx-auto bg-success/10 rounded-full flex items-center justify-center">
            <Check className="w-8 h-8 text-success" />
          </div>
          <p className="text-text font-satoshi font-bold text-xl">
            {t("depositSubmitted")}
          </p>
          <p className="text-muted-custom text-sm font-dm-sans">
            {t("depositSubmittedDesc")}
          </p>
          {compact && (
            <Button
              onClick={onBack}
              className="bg-yes hover:bg-yes/90 text-white h-12 px-8"
            >
              {tc("done")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  // --- Loading states ---
  if (status === "uploading" || status === "submitting") {
    return (
      <div className="relative">
        {compact && onBack && (
          <button
            onClick={onBack}
            className="absolute top-0 left-0 text-muted-custom hover:text-text transition-colors w-10 h-10 flex items-center justify-center rounded-full hover:bg-elevated/50"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <div className="text-center py-12 space-y-4">
          <Loader2 className="w-10 h-10 text-yes animate-spin mx-auto" />
          <p className="text-text font-dm-sans text-lg font-medium">
            {status === "uploading"
              ? t("uploadingReceipt")
              : t("submittingDeposit")}
          </p>
        </div>
      </div>
    );
  }

  // --- Main form ---
  return (
    <div className="relative flex flex-col max-h-[85dvh]">
      {/* Back button (modal mode) */}
      {compact && onBack && (
        <button
          onClick={onBack}
          className="absolute top-0 left-0 text-muted-custom hover:text-text transition-colors w-10 h-10 flex items-center justify-center rounded-full hover:bg-elevated/50 z-10"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
      )}

      {/* Header */}
      <div className={cn("flex-shrink-0", compact ? "pt-1 ps-12 mb-6" : "mb-6")}>
        <div className="flex items-center gap-3">
          <Image
            src="/icons/whish.png"
            alt="Whish"
            width={compact ? 36 : 28}
            height={compact ? 36 : 28}
            className="rounded-lg"
          />
          <div>
            <h2
              className={cn(
                "font-medium text-text font-satoshi leading-tight",
                compact ? "text-[24px]" : "text-lg font-bold"
              )}
            >
              {t("manualDepositTitle")}
            </h2>
            <p className="text-sm text-muted-custom font-dm-sans">
              {t("manualDepositInstructions")}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-6">
        {/* Whish Deposit Numbers */}
        <div>
          <p className="text-xs font-dm-sans font-semibold text-muted-custom uppercase tracking-wider mb-3">
            {t("step1SendTo")}
          </p>
          <div className="space-y-2">
            {WHISH_DEPOSIT_NUMBERS.map((wn) => (
              <div
                key={wn.number}
                className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-border-custom bg-bg text-start"
              >
                <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-elevated">
                  <Phone className="w-5 h-5 text-muted-custom" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-dm-sans font-semibold text-text">
                    {wn.label}
                  </p>
                  <p className="text-sm font-mono text-muted-custom" dir="ltr">
                    {wn.number}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Upload Receipt (required) */}
        <div>
          <p className="text-xs font-dm-sans font-semibold text-muted-custom uppercase tracking-wider mb-3">
            {t("step2Upload")}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={handleFileChange}
          />

          {proofPreview ? (
            <div className="relative rounded-xl border-2 border-yes bg-yes/5 p-3">
              <div className="relative w-full aspect-[4/3] rounded-lg overflow-hidden bg-elevated">
                <img
                  src={proofPreview}
                  alt="Receipt"
                  className="w-full h-full object-contain"
                />
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-2 text-xs font-dm-sans font-semibold text-yes hover:text-yes/80 transition-colors"
              >
                {t("changeImage")}
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex flex-col items-center justify-center gap-3 py-8 rounded-xl border-2 border-dashed border-border-custom bg-bg hover:border-yes/30 hover:bg-yes/5 transition-all active:scale-[0.99]"
            >
              <div className="w-12 h-12 rounded-full bg-elevated flex items-center justify-center">
                <Upload className="w-6 h-6 text-muted-custom" />
              </div>
              <div className="text-center">
                <p className="text-sm font-dm-sans font-medium text-text">
                  {t("tapToUpload")}
                </p>
                <p className="text-xs font-dm-sans text-muted-custom mt-1">
                  {t("supportedFormats")}
                </p>
              </div>
            </button>
          )}
          {!proofFile && (
            <p className="mt-2 text-xs font-dm-sans text-muted-custom">
              {t("receiptRequired")}
            </p>
          )}
        </div>
      </div>

      {/* Sticky submit footer */}
      <div className="flex-shrink-0 pt-4 bg-surface">
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full h-14 bg-yes hover:bg-yes/90 text-white font-dm-sans font-semibold text-base rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t("submitDeposit")}
        </Button>
      </div>
    </div>
  );
}
