"use client";

import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";

export function PageTransitionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Bypass framer-motion entirely for `/` and any `/speed/*`. Reasons:
  //   1. The mobile speed-modal is rendered via the parallel `@modal` slot;
  //      `{children}` stays on the home tree throughout. Wrapping that
  //      static tree in an `AnimatePresence + motion.div` causes
  //      framer-motion to do layout work on every pathname change even
  //      when the wrapped content is identical, which the user perceived
  //      as a jitter on back-nav from the modal.
  //   2. Speed-to-speed pill navigation needs to be flicker-free (Phase 2).
  //
  // Other routes keep the standard 100ms fade transition.
  if (pathname === "/" || pathname.startsWith("/speed/")) {
    return <>{children}</>;
  }

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
