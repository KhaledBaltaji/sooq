export const springs = {
  snappy: { type: "spring", stiffness: 500, damping: 30, mass: 0.8 } as const,
  smooth: { type: "spring", stiffness: 300, damping: 26, mass: 1 } as const,
  gentle: { type: "spring", stiffness: 200, damping: 20, mass: 1.2 } as const,
  bounce: { type: "spring", stiffness: 400, damping: 15, mass: 0.5 } as const,
} as const;

export const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
} as const;

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
} as const;

export const scaleIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
} as const;

export const slideUp = {
  initial: { y: "100%" },
  animate: { y: 0 },
  exit: { y: "100%" },
} as const;

// Standard tap animation for all interactive elements
export const tapScale = { scale: 0.97 } as const;

// Stagger children delay
export const stagger = (i: number, base = 0.04) => ({
  delay: i * base,
});
