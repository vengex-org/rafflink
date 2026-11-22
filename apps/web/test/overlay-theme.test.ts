import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { defaultOverlayTheme } from "@rafflink/core/domain/overlay-theme"
import { overlayThemeAttributes, overlayThemeStyle } from "../src/lib/overlay-theme.ts"

describe("overlayThemeStyle", () => {
  it("sets no property for the default theme, so the stylesheet draws the overlay as before", () => {
    expect(overlayThemeStyle(defaultOverlayTheme)).toEqual({})
  })

  it("sets the plate color only when the background changes", () => {
    expect(overlayThemeStyle({ ...defaultOverlayTheme, background: "#202040" })).toEqual({
      "--overlay-plate": "#202040",
    })
  })

  it("derives the muted text and the plate edge from a new text color", () => {
    expect(overlayThemeStyle({ ...defaultOverlayTheme, text: "#101010" })).toEqual({
      "--overlay-ink": "#101010",
      "--overlay-muted": "color-mix(in srgb, #101010 65%, #111113)",
      "--overlay-edge": "color-mix(in srgb, #101010 14%, transparent)",
    })
  })

  it("keeps dark text on a light accent", () => {
    expect(overlayThemeStyle({ ...defaultOverlayTheme, accent: "#ffd400" })).toEqual({
      "--accent": "#ffd400",
    })
  })

  it("puts light text on a dark accent", () => {
    expect(overlayThemeStyle({ ...defaultOverlayTheme, accent: "#3020a0" })).toEqual({
      "--accent": "#3020a0",
      "--accent-ink": "var(--on-accent-ink)",
    })
  })
})

describe("overlayThemeAttributes", () => {
  it("names the font, size, position and corners for the stylesheet", () => {
    expect(
      overlayThemeAttributes({
        ...defaultOverlayTheme,
        font: "oswald",
        size: "large",
        position: "bottom-right",
        corners: "square",
      }),
    ).toEqual({
      "data-font": "oswald",
      "data-size": "large",
      "data-position": "bottom-right",
      "data-corners": "square",
    })
  })
})

describe("default overlay theme", () => {
  it("holds the colors tokens.css gives the overlay", () => {
    const tokens = readFileSync(join(import.meta.dir, "../src/styles/tokens.css"), "utf8")
    const root = tokens.match(/:root\s*\{([^}]*)\}/)?.[1] ?? ""
    const token = (name: string) => root.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]
    expect(token("--accent")).toBe(defaultOverlayTheme.accent)
    expect(token("--overlay-plate")).toBe(defaultOverlayTheme.background)
    expect(token("--overlay-ink")).toBe(defaultOverlayTheme.text)
  })
})
