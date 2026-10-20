// Light or dark theme: the reader's saved choice, else the system's. Shared by
// the reader and the admin pages; any [data-action="toggle-theme"] button flips it.
import { getPref, setPref } from "./storage.js";

function effectiveTheme() {
  const set = document.documentElement.dataset.theme;
  if (set) return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const label = effectiveTheme() === "dark" ? "Switch to light theme" : "Switch to dark theme";
  document.querySelectorAll('[data-action="toggle-theme"]').forEach((b) => b.setAttribute("aria-label", label));
}

applyTheme(getPref("theme", null));

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(getPref("theme", null)));

document.addEventListener("click", (e) => {
  if (!e.target.closest('[data-action="toggle-theme"]')) return;
  const theme = effectiveTheme() === "dark" ? "light" : "dark";
  setPref("theme", theme);
  applyTheme(theme);
});
