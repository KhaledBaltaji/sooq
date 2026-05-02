"use client";

import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { makeQueryClient } from "./client";

// Load devtools via next/dynamic so the module resolves through the same
// bundler graph as the main @tanstack/react-query instance. The previous
// require() pattern broke under Turbopack (Next 16): devtools loaded into a
// separate module copy and its useQueryClient() lookup missed our provider.
const ReactQueryDevtools = dynamic(
  () =>
    import("@tanstack/react-query-devtools").then((m) => ({
      default: m.ReactQueryDevtools,
    })),
  { ssr: false }
);

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => makeQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" ? (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
      ) : null}
    </QueryClientProvider>
  );
}
