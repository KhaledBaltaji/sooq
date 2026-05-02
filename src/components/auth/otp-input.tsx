"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { AlertCircle } from "lucide-react";

interface OTPInputProps {
  onSubmit: (code: string) => void;
  onResend: () => void;
  loading?: boolean;
  error?: string | null;
}

export function OTPInput({ onSubmit, onResend, loading, error }: OTPInputProps) {
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [countdown, setCountdown] = useState(60);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // Auto-submit when all 6 digits filled
  useEffect(() => {
    const code = digits.join("");
    if (code.length === 6 && digits.every((d) => d !== "")) {
      onSubmit(code);
    }
  }, [digits, onSubmit]);

  const handleChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;
    const newDigits = [...digits];
    newDigits[index] = value;
    setDigits(newDigits);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
      setActiveIndex(index + 1);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      setActiveIndex(index - 1);
    }
  };

  const handleFocus = (index: number) => {
    setActiveIndex(index);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      setDigits(pasted.split(""));
      inputRefs.current[5]?.focus();
      setActiveIndex(5);
    }
  };

  const handleResend = () => {
    setCountdown(60);
    setDigits(["", "", "", "", "", ""]);
    inputRefs.current[0]?.focus();
    setActiveIndex(0);
    onResend();
  };

  return (
    <div className="w-full flex flex-col items-center">
      {/* OTP digit boxes */}
      <div className="flex gap-3 mb-8" onPaste={handlePaste}>
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            enterKeyHint="go"
            pattern="[0-9]*"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onFocus={() => handleFocus(i)}
            className={cn(
              "w-[52px] h-[56px] text-center text-2xl font-bold font-satoshi rounded-md",
              "bg-bg transition-all outline-none",
              activeIndex === i && !digit
                ? "border-2 border-yes shadow-[0_0_20px_rgba(45,140,255,0.15)]"
                : digit
                  ? "border border-border-custom text-text"
                  : "border border-border-custom"
            )}
          />
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-2 mb-6 text-no text-xs">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <p className="text-muted-custom text-sm mb-6">Verifying...</p>
      )}

      {/* Resend section */}
      <div className="w-full pt-6 border-t border-border-custom/30 flex flex-col items-center gap-3">
        <span className="text-dim text-xs">Didn&apos;t receive the code?</span>
        {countdown > 0 ? (
          <span className="text-muted-custom text-sm font-medium">
            Resend code <span className="text-yes/50 tabular-nums">in {countdown}s</span>
          </span>
        ) : (
          <button
            onClick={handleResend}
            className="text-yes text-sm font-medium hover:underline transition-colors"
          >
            Resend code
          </button>
        )}
      </div>
    </div>
  );
}
