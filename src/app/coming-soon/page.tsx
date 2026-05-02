import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "sooq — قريباً",
  description: "سوق التوقعات السياسية في لبنان والشرق الأوسط. قريباً.",
  openGraph: {
    title: "sooq — قريباً",
    description: "سوق التوقعات السياسية في لبنان والشرق الأوسط",
  },
};

export default function ComingSoonPage() {
  return (
    <div className="fixed inset-0 bg-bg flex items-center justify-center overflow-hidden">
      {/* Subtle grain overlay */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PGZlQ29sb3JNYXRyaXggdHlwZT0ic2F0dXJhdGUiIHZhbHVlcz0iMCIvPjwvZmlsdGVyPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbHRlcj0idXJsKCNhKSIvPjwvc3ZnPg==')]" />

      <div className="relative text-center px-6">
        {/* Logo / Brand */}
        <h1 className="font-satoshi font-black text-[64px] md:text-[96px] text-text tracking-tight leading-none mb-4">
          sooq
        </h1>

        {/* Accent line */}
        <div className="w-12 h-[2px] bg-yes mx-auto mb-6" />

        {/* Arabic tagline */}
        <p className="font-noto-sans-arabic text-xl md:text-2xl text-muted-custom mb-2" dir="rtl">
          قريباً
        </p>

        {/* English subtitle */}
        <p className="font-dm-sans text-sm text-dim tracking-wide uppercase">
          Prediction Exchange — Coming Soon
        </p>

        {/* Domain */}
        <p className="font-dm-sans text-xs text-dim mt-8 tracking-widest">
          sooq.exchange
        </p>
      </div>
    </div>
  );
}
