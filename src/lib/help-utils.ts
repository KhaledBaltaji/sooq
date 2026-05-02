import {
  BookOpen,
  Shield,
  CreditCard,
  Wallet,
  Users,
  Globe,
  Lock,
  Zap,
  TrendingUp,
  Info,
  Coins,
  Settings,
  HelpCircle,
  Flag,
  Scale,
  FileText,
  AlertTriangle,
  Rocket,
  Gavel,
  Layers,
  type LucideIcon,
} from "lucide-react";

export const HELP_ICON_MAP: Record<string, LucideIcon> = {
  "book-open": BookOpen,
  shield: Shield,
  "credit-card": CreditCard,
  wallet: Wallet,
  users: Users,
  globe: Globe,
  lock: Lock,
  zap: Zap,
  "trending-up": TrendingUp,
  info: Info,
  coins: Coins,
  settings: Settings,
  "help-circle": HelpCircle,
  flag: Flag,
  scale: Scale,
  "file-text": FileText,
  "alert-triangle": AlertTriangle,
  rocket: Rocket,
  gavel: Gavel,
  layers: Layers,
};

export const HELP_ICON_OPTIONS = Object.keys(HELP_ICON_MAP);

export function getHelpIcon(name: string): LucideIcon {
  return HELP_ICON_MAP[name] || HelpCircle;
}

export function extractPreview(markdown: string, maxLength = 200): string {
  const stripped = markdown
    .replace(/^#{1,6}\s+.*/gm, "") // remove headings
    .replace(/!\[.*?\]\(.*?\)/g, "") // remove images
    .replace(/\[([^\]]*)\]\(.*?\)/g, "$1") // links → text
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // bold → text
    .replace(/(\*|_)(.*?)\1/g, "$2") // italic → text
    .replace(/`{1,3}[^`]*`{1,3}/g, "") // remove code
    .replace(/^\s*[-*+]\s+/gm, "") // remove list markers
    .replace(/^\s*\d+\.\s+/gm, "") // remove ordered list markers
    .replace(/\n+/g, " ") // newlines → spaces
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();

  if (stripped.length <= maxLength) return stripped;

  // Find the last sentence boundary (. ! ?) within maxLength
  const chunk = stripped.slice(0, maxLength);
  const match = chunk.match(/^([\s\S]*[.!?])(?:\s|$)/);
  if (match && match[1].length > 30) {
    return match[1];
  }

  // Fallback: break at last word
  return chunk.replace(/\s\S*$/, "") + "…";
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
