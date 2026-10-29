/*
  Whether the page shows the dark theme: the View theme setting puts "light" or "dark" in
  <html data-theme>, and without it the system's preference decides (styles.css follows the
  same rule).
*/
const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

export function isDark(): boolean {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : Boolean(media?.matches);
}

/** Call `fn` whenever the theme may have changed (the setting or the system's preference). */
export function onThemeChange(fn: () => void): void {
  media?.addEventListener("change", fn);
  new MutationObserver(fn).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}
