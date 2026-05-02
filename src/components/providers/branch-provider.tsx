"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { BranchPublic } from "@/types/branch";

interface BranchContextValue {
  branch: BranchPublic;
}

const BranchContext = createContext<BranchContextValue | null>(null);

/**
 * Returns branch context or null when outside /b/ routes.
 * Components check null to fall through to retail behavior.
 */
export function useBranchContext(): BranchContextValue | null {
  return useContext(BranchContext);
}

export function BranchProvider({
  branch,
  children,
}: {
  branch: BranchPublic;
  children: ReactNode;
}) {
  return (
    <BranchContext.Provider value={{ branch }}>
      {children}
    </BranchContext.Provider>
  );
}
