import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";

interface AdminEmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function AdminEmptyState({
  icon: Icon = Inbox,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: AdminEmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-xl text-center", className)}>
      <div className="w-12 h-12 bg-elevated rounded-full flex items-center justify-center mb-md">
        <Icon className="w-6 h-6 text-dim" />
      </div>
      <h4 className="font-satoshi text-base font-bold text-text mb-xs">{title}</h4>
      {description && (
        <p className="text-muted text-sm max-w-[280px]">{description}</p>
      )}
      {actionLabel && onAction && (
        <Button onClick={onAction} className="mt-md" size="sm">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
