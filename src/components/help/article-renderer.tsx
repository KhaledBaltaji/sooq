"use client";

import ReactMarkdown from "react-markdown";
import { slugify } from "@/lib/help-utils";

function headingId(children: React.ReactNode): string {
  const text = typeof children === "string" ? children : String(children);
  return slugify(text);
}

export function ArticleRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        h1: ({ children }) => (
          <h1
            id={headingId(children)}
            className="font-satoshi text-lg font-bold text-text mt-md mb-sm"
          >
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2
            id={headingId(children)}
            className="font-satoshi text-base font-bold text-text mt-md mb-sm"
          >
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3
            id={headingId(children)}
            className="font-satoshi text-sm font-semibold text-text mt-md mb-xs"
          >
            {children}
          </h3>
        ),
        p: ({ children }) => (
          <p className="font-dm-sans text-sm text-muted-custom leading-relaxed mb-sm">
            {children}
          </p>
        ),
        ul: ({ children }) => (
          <ul className="list-disc list-inside font-dm-sans text-sm text-muted-custom space-y-xs mb-sm ps-sm">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-inside font-dm-sans text-sm text-muted-custom space-y-xs mb-sm ps-sm">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        a: ({ href, children }) => (
          <a
            href={href}
            className="text-yes hover:underline"
            target={href?.startsWith("http") ? "_blank" : undefined}
            rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
          >
            {children}
          </a>
        ),
        strong: ({ children }) => (
          <strong className="text-text font-semibold">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        blockquote: ({ children }) => (
          <blockquote className="border-s-2 border-yes/30 ps-md my-sm text-text/70 italic">
            {children}
          </blockquote>
        ),
        code: ({ children }) => (
          <code className="bg-elevated px-1.5 py-0.5 rounded text-xs font-mono text-text">
            {children}
          </code>
        ),
        hr: () => <hr className="border-elevated my-md" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
