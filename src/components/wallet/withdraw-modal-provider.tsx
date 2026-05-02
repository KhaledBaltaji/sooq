"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { WithdrawModal } from "./withdraw-modal";

interface WithdrawModalContextType {
  openWithdrawModal: () => void;
  closeWithdrawModal: () => void;
  isWithdrawModalOpen: boolean;
}

const WithdrawModalContext = createContext<WithdrawModalContextType>({
  openWithdrawModal: () => {},
  closeWithdrawModal: () => {},
  isWithdrawModalOpen: false,
});

export function useWithdrawModal() {
  return useContext(WithdrawModalContext);
}

export function WithdrawModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const openWithdrawModal = useCallback(() => setIsOpen(true), []);
  const closeWithdrawModal = useCallback(() => setIsOpen(false), []);

  return (
    <WithdrawModalContext.Provider value={{ openWithdrawModal, closeWithdrawModal, isWithdrawModalOpen: isOpen }}>
      {children}
      <WithdrawModal open={isOpen} onClose={closeWithdrawModal} />
    </WithdrawModalContext.Provider>
  );
}
