"use client";

import { useEffect, useState } from "react";

interface CountdownProps {
  target: Date | string | number;
  className?: string;
}

export function Countdown({ target, className }: CountdownProps) {
  const targetMs = typeof target === "number" ? target : new Date(target).getTime();
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const deltaMs = Math.max(0, targetMs - Date.now());
    const intervalMs = deltaMs < 3_600_000 ? 1_000 : 60_000;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [targetMs]);

  const delta = Math.max(0, targetMs - now);
  const d = Math.floor(delta / 86_400_000);
  const h = Math.floor((delta % 86_400_000) / 3_600_000);
  const m = Math.floor((delta % 3_600_000) / 60_000);
  const s = Math.floor((delta % 60_000) / 1000);

  const text = d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;

  return (
    <span className={className} suppressHydrationWarning>
      {text}
    </span>
  );
}
