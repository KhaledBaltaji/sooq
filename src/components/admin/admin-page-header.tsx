import type { ReactNode } from "react";

interface AdminPageHeaderProps {
  title: string;
  description?: string;
  children?: ReactNode;
}

export function AdminPageHeader({ title, description, children }: AdminPageHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-lg">
      <div>
        <h1 className="font-satoshi text-xl font-bold text-text">{title}</h1>
        {description && (
          <p className="text-muted text-sm font-dm-sans mt-xs">{description}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-sm">{children}</div>}
    </div>
  );
}
