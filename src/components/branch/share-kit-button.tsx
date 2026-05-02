"use client";

import { useState } from "react";
import { ShareKitModal } from "./share-kit-modal";

interface ShareKitButtonProps {
  branchCode: string;
  branchName: string;
  className?: string;
}

/**
 * Client-side button that opens the ShareKitModal. Used on the commission
 * branch dashboard overview and anywhere else the manager wants to share
 * their branch link quickly.
 */
export function ShareKitButton({ branchCode, branchName, className }: ShareKitButtonProps) {
  const [open, setOpen] = useState(false);
  // Derive origin at render time so the modal builds correct absolute URLs
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={className ??
          "px-5 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold"}
      >
        Share your branch →
      </button>
      <ShareKitModal
        open={open}
        onOpenChange={setOpen}
        branchCode={branchCode}
        branchName={branchName}
        origin={origin}
      />
    </>
  );
}
