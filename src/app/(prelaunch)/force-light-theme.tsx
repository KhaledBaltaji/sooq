"use client";

import { useEffect } from "react";

export function ForceLightTheme() {
  useEffect(() => {
    // Save previous theme state
    const prevAttr = document.documentElement.getAttribute("data-theme");
    const prevStorage = localStorage.getItem("theme");

    // Force light — both attribute AND localStorage so ThemeProvider doesn't override
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.setItem("theme", "light");

    return () => {
      // Restore previous state on unmount
      if (prevAttr) document.documentElement.setAttribute("data-theme", prevAttr);
      if (prevStorage) {
        localStorage.setItem("theme", prevStorage);
      } else {
        localStorage.removeItem("theme");
      }
    };
  }, []);

  return null;
}
