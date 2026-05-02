import Link from "next/link";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="text-sm text-muted-custom font-dm-sans mb-6">
      <ol className="flex items-baseline overflow-x-auto">
        {items.map((item, i) => (
          <li key={i} className="inline-flex items-baseline whitespace-nowrap">
            {i > 0 && <span className="text-dim mx-2">/</span>}
            {item.href ? (
              <Link href={item.href} className="hover:text-text transition-colors">
                {item.label}
              </Link>
            ) : (
              <span className="text-text font-medium">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
