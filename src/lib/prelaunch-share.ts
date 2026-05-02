export function shareOnWhatsApp(message: string, url: string) {
  const fullMessage = `${message}\n${url}`;
  const encoded = encodeURIComponent(fullMessage);
  window.open(`https://wa.me/?text=${encoded}`, "_blank");
}

export function copyToClipboard(text: string): Promise<boolean> {
  return navigator.clipboard
    .writeText(text)
    .then(() => true)
    .catch(() => false);
}

export function getShareUrl(referralCode: string): string {
  return `${window.location.origin}/shu-rayak?ref=${referralCode}`;
}
