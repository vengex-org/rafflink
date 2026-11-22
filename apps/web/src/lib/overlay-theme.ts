import {
  defaultOverlayTheme,
  type OverlayFont,
  type OverlayTheme,
} from "@rafflink/core/domain/overlay-theme"

/** The `font-family` of each overlay font, which is also its name in the settings in every language. */
export const overlayFontFamilies: Readonly<Record<OverlayFont, string>> = {
  geist: "Geist",
  quicksand: "Quicksand",
  "space-grotesk": "Space Grotesk",
  oswald: "Oswald",
}

/**
 * The custom properties a theme changes on the overlay's root, for React to set through `style.setProperty`,
 * which the CSP allows. Only colors that differ from the default are set, so the default theme leaves
 * every color to tokens.css.
 */
export function overlayThemeStyle(theme: OverlayTheme): Record<string, string> {
  const style: Record<string, string> = {}
  const background = theme.background !== defaultOverlayTheme.background
  const text = theme.text !== defaultOverlayTheme.text
  if (background) style["--overlay-plate"] = theme.background
  if (text) {
    style["--overlay-ink"] = theme.text
    style["--overlay-edge"] = `color-mix(in srgb, ${theme.text} 14%, transparent)`
  }
  // Muted text sits between the text and the plate, so either one changing moves it.
  if (background || text) {
    style["--overlay-muted"] = `color-mix(in srgb, ${theme.text} 65%, ${theme.background})`
  }
  if (theme.accent !== defaultOverlayTheme.accent) {
    style["--accent"] = theme.accent
    if (!isLight(theme.accent)) style["--accent-ink"] = "var(--on-accent-ink)"
  }
  return style
}

// WCAG AA for body text; the overlay's smallest text (the host row, the labels) is no larger.
const minContrast = 4.5

/** Whether the text color reads too faintly on the plates: a contrast ratio under WCAG AA. */
export function hasLowContrast(theme: Pick<OverlayTheme, "text" | "background">): boolean {
  const [lighter, darker] = [luminance(theme.text), luminance(theme.background)].toSorted(
    (a, b) => b - a,
  )
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05) < minContrast
}

/** The data attributes overlay.css draws the font, size, position and corners from. */
export function overlayThemeAttributes(theme: OverlayTheme) {
  return {
    "data-font": theme.font,
    "data-size": theme.size,
    "data-position": theme.position,
    "data-corners": theme.corners,
  } as const
}

// Above this relative luminance dark text reads better than light (the point where both contrast ratios meet).
const lightLuminance = 0.179

function isLight(color: string): boolean {
  return luminance(color) > lightLuminance
}

/** The WCAG relative luminance of `color`, which is `#rrggbb` as the theme parser guarantees. */
function luminance(color: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(color.slice(at, at + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
