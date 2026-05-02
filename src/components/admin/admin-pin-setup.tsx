"use client";

import { useState, useRef, useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

const PIN_LENGTH = 6;

function PinInput({
  value,
  onChange,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (val: string) => void;
  label: string;
  autoFocus?: boolean;
}) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (autoFocus && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [autoFocus]);

  const handleChange = (index: number, char: string) => {
    if (!/^\d*$/.test(char)) return; // digits only
    const newPin = value.split("");
    newPin[index] = char;
    const joined = newPin.join("").slice(0, PIN_LENGTH);
    onChange(joined);
    if (char && index < PIN_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !value[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      const newPin = value.split("");
      newPin[index - 1] = "";
      onChange(newPin.join(""));
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, PIN_LENGTH);
    onChange(pasted);
    const focusIndex = Math.min(pasted.length, PIN_LENGTH - 1);
    inputRefs.current[focusIndex]?.focus();
  };

  return (
    <div>
      <label className="block text-xs font-bold text-[#566166] uppercase tracking-wider mb-3">
        {label}
      </label>
      <div className="flex gap-2 justify-center">
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <input
            key={i}
            ref={(el) => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={value[i] || ""}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={i === 0 ? handlePaste : undefined}
            className="w-12 h-14 bg-[#f0f4f7] border-2 border-transparent rounded-xl text-center text-xl font-bold text-[#2a3439] font-mono focus:ring-0 focus:border-[var(--yes)] focus:outline-none transition-colors"
            style={{ caretColor: "#2D8CFF" }}
          />
        ))}
      </div>
    </div>
  );
}

interface AdminPinSetupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function AdminPinSetup({ open, onOpenChange, onSuccess }: AdminPinSetupProps) {
  const t = useTranslations("toast");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"enter" | "confirm">("enter");

  useEffect(() => {
    if (!open) {
      setPin("");
      setConfirmPin("");
      setStep("enter");
    }
  }, [open]);

  const handlePinComplete = (val: string) => {
    setPin(val);
    if (val.length === PIN_LENGTH) {
      setTimeout(() => setStep("confirm"), 200);
    }
  };

  const handleConfirmComplete = (val: string) => {
    setConfirmPin(val);
  };

  const handleSubmit = async () => {
    if (pin.length !== PIN_LENGTH) {
      toast.error(t("pinMustBeLength", { length: PIN_LENGTH }));
      return;
    }
    if (pin !== confirmPin) {
      toast.error(t("pinsDoNotMatch"));
      setConfirmPin("");
      setStep("confirm");
      return;
    }

    setLoading(true);
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      const { error } = await supabase.rpc("admin_set_pin", { p_pin: pin });
      if (error) throw error;

      toast.success(t("pinConfigured"));
      setPin("");
      setConfirmPin("");
      onSuccess();
      onOpenChange(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to set PIN";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white rounded-2xl border-none shadow-2xl max-w-md">
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-manrope)] text-[#2a3439]">
            Set Admin PIN
          </DialogTitle>
          <DialogDescription className="text-[#566166] text-sm">
            Create a {PIN_LENGTH}-digit PIN to authorize credit and debit operations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="bg-amber-50 rounded-xl p-4 flex items-start gap-3">
            <span className="material-symbols-outlined text-lg mt-0.5 text-amber-600">security</span>
            <div>
              <p className="text-sm font-semibold text-amber-800">Security Notice</p>
              <p className="text-xs mt-1 text-amber-700">
                This PIN protects admin balance operations. After 5 failed attempts, your PIN will be locked for 15 minutes.
              </p>
            </div>
          </div>

          {step === "enter" ? (
            <PinInput
              value={pin}
              onChange={handlePinComplete}
              label={`Enter ${PIN_LENGTH}-digit PIN`}
              autoFocus
            />
          ) : (
            <PinInput
              value={confirmPin}
              onChange={handleConfirmComplete}
              label="Confirm PIN"
              autoFocus
            />
          )}

          {step === "confirm" && (
            <button
              onClick={() => { setStep("enter"); setConfirmPin(""); }}
              className="text-xs text-[var(--yes)] font-semibold hover:underline mx-auto block"
            >
              Go back and change PIN
            </button>
          )}
        </div>

        <DialogFooter className="gap-3 pt-2">
          <button
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="px-5 py-2.5 bg-[#f0f4f7] text-[#566166] font-semibold rounded-lg hover:bg-[#e8eff3] transition-all text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || pin.length !== PIN_LENGTH || confirmPin.length !== PIN_LENGTH || step !== "confirm"}
            className="px-6 py-2.5 bg-[var(--yes)] text-white font-bold rounded-lg hover:opacity-90 transition-all text-sm disabled:opacity-50 flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-sm">lock</span>
            {loading ? "Setting..." : "Set PIN"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
