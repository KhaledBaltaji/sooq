"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";

type Theme = "dark" | "light" | "system";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getResolvedTheme(theme: Theme): "dark" | "light" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");

  const applyTheme = useCallback((t: Theme) => {
    const resolved = t === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : t;
    document.documentElement.setAttribute("data-theme", resolved);
    // Keep address-bar tint (Android Chrome in standalone) in sync with the in-app
    // toggle, which can differ from the OS preference. Use a dedicated non-media
    // meta-color tag so we don't clobber the SSR'd (prefers-color-scheme) fallbacks.
    const color = resolved === "dark" ? "#0A0B0E" : "#F5F5F7";
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = color;
  }, []);

  useEffect(() => {
    // iOS Safari throws SecurityError on localStorage access when the user
    // has "Block All Cookies" enabled or is in restricted Private mode.
    // Treat any failure as "no stored preference" and fall back to light.
    let stored: Theme | null = null;
    try {
      stored = localStorage.getItem("theme") as Theme | null;
    } catch {
      stored = null;
    }
    if (stored && ["dark", "light", "system"].includes(stored)) {
      setThemeState(stored);
      applyTheme(stored);
    } else {
      setThemeState("light");
      applyTheme("light");
    }
  }, [applyTheme]);

  // Listen for system preference changes when theme is "system"
  useEffect(() => {
    if (theme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      applyTheme("system");
      // mark unused to keep effect deps accurate
      void e;
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme, applyTheme]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem("theme", newTheme);
    } catch {
      // SecurityError on iOS Safari with cookies blocked — preference
      // applies for the session but won't persist across reloads.
    }
    applyTheme(newTheme);
  };

  const toggleTheme = () => {
    const resolved = getResolvedTheme(theme);
    setTheme(resolved === "dark" ? "light" : "dark");
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
