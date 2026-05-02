// Loaded synchronously in <head> to set data-theme before first paint.
// Avoids flash-of-unstyled-content (FOUC) when user has dark mode set.
// Lives as a static file (not inline in layout.tsx) because React 19 +
// Next 16 reject inline <script dangerouslySetInnerHTML> in component
// trees as a hard error.
(function () {
  try {
    var t = localStorage.getItem("theme");
    if (t === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else if (t === "system") {
      var d = window.matchMedia("(prefers-color-scheme:dark)").matches
        ? "dark"
        : "light";
      document.documentElement.setAttribute("data-theme", d);
    } else {
      document.documentElement.setAttribute("data-theme", "light");
    }
  } catch (e) {
    // localStorage blocked or matchMedia unavailable — leave default theme.
  }
})();
