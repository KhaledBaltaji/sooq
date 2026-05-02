import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-elevated flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-muted-custom" />
      </div>
      <h3 className="text-md font-medium text-text mb-1">{title}</h3>
      <p className="text-sm text-muted-custom max-w-[280px]">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 bg-yes text-white text-sm font-medium rounded-lg transition-colors hover:brightness-110"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
