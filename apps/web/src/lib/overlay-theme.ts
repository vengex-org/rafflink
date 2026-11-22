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
  if (theme.background !== defaultOverlayTheme.background) {
    style["--overlay-plate"] = theme.background
  }
  if (theme.text !== defaultOverlayTheme.text) {
    style["--overlay-ink"] = theme.text
    style["--overlay-muted"] = `color-mix(in srgb, ${theme.text} 65%, ${theme.background})`
    style["--overlay-edge"] = `color-mix(in srgb, ${theme.text} 14%, transparent)`
  }
  if (theme.accent !== defaultOverlayTheme.accent) {
    style["--accent"] = theme.accent
    if (!isLight(theme.accent)) style["--accent-ink"] = "var(--on-accent-ink)"
  }
  return style
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

/** `color` is `#rrggbb`, as the theme parser guarantees. */
function isLight(color: string): boolean {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(color.slice(at, at + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > lightLuminance
}
