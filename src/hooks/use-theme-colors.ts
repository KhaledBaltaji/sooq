"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/components/providers/theme-provider";

const DARK_DEFAULTS = {
  bg: "#000000",
  surface: "#111113",
  elevated: "#1A1A1F",
  border: "#222228",
  text: "#FFFFFF",
  muted: "#8A8A98",
  dim: "#3A3A42",
  yes: "#2D8CFF",
  no: "#FF4757",
  success: "#00E87B",
  error: "#FF4757",
  warning: "#FFB800",
  info: "#2D8CFF",
};

function getColors() {
  if (typeof window === "undefined") return DARK_DEFAULTS;
  const style = getComputedStyle(document.documentElement);
  return {
    bg: style.getPropertyValue("--bg").trim() || DARK_DEFAULTS.bg,
    surface: style.getPropertyValue("--surface").trim() || DARK_DEFAULTS.surface,
    elevated: style.getPropertyValue("--elevated").trim() || DARK_DEFAULTS.elevated,
    border: style.getPropertyValue("--border").trim() || DARK_DEFAULTS.border,
    text: style.getPropertyValue("--text").trim() || DARK_DEFAULTS.text,
    muted: style.getPropertyValue("--muted").trim() || DARK_DEFAULTS.muted,
    dim: style.getPropertyValue("--dim").trim() || DARK_DEFAULTS.dim,
    yes: style.getPropertyValue("--yes").trim() || DARK_DEFAULTS.yes,
    no: style.getPropertyValue("--no").trim() || DARK_DEFAULTS.no,
    success: style.getPropertyValue("--success").trim() || DARK_DEFAULTS.success,
    error: style.getPropertyValue("--error").trim() || DARK_DEFAULTS.error,
    warning: style.getPropertyValue("--warning").trim() || DARK_DEFAULTS.warning,
    info: style.getPropertyValue("--info").trim() || DARK_DEFAULTS.info,
  };
}

export function useThemeColors() {
  const { theme } = useTheme();
  const [colors, setColors] = useState(DARK_DEFAULTS);

  useEffect(() => {
    // Small delay to ensure CSS variables have been applied after theme switch
    const id = requestAnimationFrame(() => setColors(getColors()));
    return () => cancelAnimationFrame(id);
  }, [theme]);

  return colors;
}
