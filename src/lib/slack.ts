import { logger } from "@/lib/logger";

/**
 * Send an alert to the configured Slack webhook.
 * Silently skips if SLACK_WEBHOOK_URL is not set.
 */
export async function sendSlackAlert(messages: string[]) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const env = process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown";
  const text = [
    `:rotating_light: *MENA Prediction Market — ${messages.length} issue(s) detected* [${env}]`,
    "",
    ...messages.map((msg, i) => `${i + 1}. ${msg}`),
    "",
    `_${new Date().toISOString()}_`,
  ].join("\n");

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    logger.warn("Failed to send Slack alert", {
      source: "slack",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}
