import { readStored, writeStored } from "../lib/safe-storage.ts"

export const themes = ["system", "light", "dark"] as const
export type Theme = (typeof themes)[number]

// index.html reads the same key before first paint.
export const themeStorageKey = "rafflink-theme"

export const darkQuery = "(prefers-color-scheme: dark)"

export function storedTheme(): Theme {
  return parseTheme(readStored(themeStorageKey)) ?? "system"
}

export function storeTheme(theme: Theme): void {
  writeStored(themeStorageKey, theme)
}

export function parseTheme(text: string | null): Theme | null {
  return themes.find((theme) => theme === text) ?? null
}

/** Sets `data-theme` on the root to the scheme the page shows: `System` resolves through the OS preference. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme === "system" ? systemScheme() : theme
}

function systemScheme(): "light" | "dark" {
  return window.matchMedia(darkQuery).matches ? "dark" : "light"
}
