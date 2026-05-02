"use client";

import { useState, useEffect } from "react";

export function LanguageSelectorModal() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Only show if user has never selected a language
    const hasSelected = document.cookie.includes("locale_selected=true");
    if (!hasSelected) {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  const selectLanguage = (locale: "en" | "ar") => {
    document.cookie = `locale=${locale};path=/;max-age=31536000`;
    document.cookie = `locale_selected=true;path=/;max-age=31536000`;
    setShow(false);
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative z-10 min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-[400px] bg-surface rounded-lg p-8 shadow-[0_8px_32px_rgba(0,0,0,0.25)] animate-in fade-in zoom-in-95 duration-200">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <span className="font-satoshi font-black text-yes text-xl tracking-tighter">sooq</span>
          </div>

          {/* Content */}
          <div className="text-center mb-8">
            <h2 className="text-lg font-medium text-text font-satoshi mb-1">
              Choose your language
            </h2>
            <p className="text-base text-muted-custom font-noto-arabic">
              اختر لغتك
            </p>
          </div>

          {/* Language buttons */}
          <div className="flex flex-col gap-3">
            <button
              onClick={() => selectLanguage("en")}
              className="w-full h-14 bg-bg border border-border-custom rounded-lg px-6 text-text font-satoshi font-bold text-base hover:border-yes hover:bg-yes/5 transition-all active:scale-[0.97] cursor-pointer flex items-center justify-between"
            >
              <span>English</span>
              <span className="text-sm text-muted-custom">EN</span>
            </button>
            <button
              onClick={() => selectLanguage("ar")}
              className="w-full h-14 bg-bg border border-border-custom rounded-lg px-6 text-text font-noto-arabic font-bold text-base hover:border-yes hover:bg-yes/5 transition-all active:scale-[0.97] cursor-pointer flex items-center justify-between"
            >
              <span>العربية</span>
              <span className="text-sm text-muted-custom font-satoshi">AR</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
