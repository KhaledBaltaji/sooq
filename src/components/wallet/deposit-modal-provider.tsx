"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { DepositModal } from "./deposit-modal";

interface DepositModalContextType {
  openDepositModal: () => void;
  closeDepositModal: () => void;
  isDepositModalOpen: boolean;
}

const DepositModalContext = createContext<DepositModalContextType>({
  openDepositModal: () => {},
  closeDepositModal: () => {},
  isDepositModalOpen: false,
});

export function useDepositModal() {
  return useContext(DepositModalContext);
}

export function DepositModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const openDepositModal = useCallback(() => setIsOpen(true), []);
  const closeDepositModal = useCallback(() => setIsOpen(false), []);

  return (
    <DepositModalContext.Provider value={{ openDepositModal, closeDepositModal, isDepositModalOpen: isOpen }}>
      {children}
      <DepositModal open={isOpen} onClose={closeDepositModal} />
    </DepositModalContext.Provider>
  );
}
