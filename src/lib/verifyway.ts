/**
 * VerifyWay WhatsApp OTP delivery.
 * Server-only — sends OTP codes via WhatsApp using VerifyWay API.
 * We generate and verify codes ourselves; VerifyWay only delivers.
 */

const VERIFYWAY_API_URL = "https://api.verifyway.com/api/v1/";

export async function sendWhatsAppOTP(
  phone: string,
  code: string,
  lang: "en" | "ar" = "en"
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const apiKey = process.env.VERIFYWAY_API_KEY;
  if (!apiKey) {
    return { success: false, error: "VERIFYWAY_API_KEY not configured" };
  }

  try {
    const res = await fetch(VERIFYWAY_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        recipient: phone, // E.164 format with +
        type: "otp",
        channel: "whatsapp",
        code,
        lang,
        fallback: "no",
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        success: false,
        error: `VerifyWay HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    const data = await res.json();

    if (data.status === "success") {
      return { success: true, messageId: data.message_id };
    }

    return { success: false, error: data.error || "WhatsApp delivery failed" };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "WhatsApp delivery failed",
    };
  }
}
