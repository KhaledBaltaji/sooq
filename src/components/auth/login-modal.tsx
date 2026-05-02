"use client";

import { useEffect } from "react";
import { AuthSteps } from "./auth-steps";
import { cn } from "@/lib/utils";

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
}

export function LoginModal({ open, onClose }: LoginModalProps) {
  // Lock body scroll when modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop — blurs the home page behind */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Auth card container */}
      <div className="relative z-10 min-h-screen flex items-center justify-center p-6">
        <div
          className={cn(
            "w-full max-w-[420px]",
            "animate-in fade-in zoom-in-95 duration-200"
          )}
        >
          <AuthSteps onAuthSuccess={onClose} />
        </div>
      </div>
    </div>
  );
}
