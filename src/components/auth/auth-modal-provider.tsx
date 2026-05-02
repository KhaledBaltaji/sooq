"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { LoginModal } from "./login-modal";

interface AuthModalContextType {
  openLoginModal: () => void;
  closeLoginModal: () => void;
  isLoginModalOpen: boolean;
}

const AuthModalContext = createContext<AuthModalContextType>({
  openLoginModal: () => {},
  closeLoginModal: () => {},
  isLoginModalOpen: false,
});

export function useAuthModal() {
  return useContext(AuthModalContext);
}

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const openLoginModal = useCallback(() => setIsOpen(true), []);
  const closeLoginModal = useCallback(() => setIsOpen(false), []);

  return (
    <AuthModalContext.Provider value={{ openLoginModal, closeLoginModal, isLoginModalOpen: isOpen }}>
      {children}
      <LoginModal open={isOpen} onClose={closeLoginModal} />
    </AuthModalContext.Provider>
  );
}
