const PHONE_DIGITS = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? "").replace(/[^\d]/g, "");

export function isSupportWhatsAppConfigured(): boolean {
  return PHONE_DIGITS.length > 0;
}

export function getSupportWhatsAppHref(message: string): string {
  if (!PHONE_DIGITS) return "#";
  return `https://wa.me/${PHONE_DIGITS}?text=${encodeURIComponent(message)}`;
}
