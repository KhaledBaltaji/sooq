"use client";

import { useState } from "react";
import PhoneInputLib from "react-phone-number-input";
import "react-phone-number-input/style.css";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface PhoneInputProps {
  onSubmit: (phone: string) => void;
  loading?: boolean;
  error?: string | null;
}

export function PhoneInput({ onSubmit, loading, error }: PhoneInputProps) {
  const t = useTranslations("auth");
  const [phone, setPhone] = useState<string>("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (phone && phone.length >= 8) {
      onSubmit(phone);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="phone-input-wrapper">
        <PhoneInputLib
          international
          defaultCountry="LB"
          value={phone}
          onChange={(value) => setPhone(value || "")}
          className="phone-input-custom"
        />
      </div>

      {error && <p className="text-no text-sm">{error}</p>}

      <button
        type="submit"
        disabled={!phone || phone.length < 8 || loading}
        className={cn(
          "w-full h-12 bg-yes text-white font-bold text-sm rounded-md",
          "transition-all active:scale-[0.97] cursor-pointer",
          "hover:shadow-[0_0_20px_rgba(45,140,255,0.25)]",
          "disabled:opacity-50 disabled:cursor-not-allowed"
        )}
      >
        {loading ? t("sendingCode") : t("sendCode")}
      </button>
    </form>
  );
}
