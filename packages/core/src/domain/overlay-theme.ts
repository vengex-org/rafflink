import type { Parsed } from "../lib/parsed.ts"

/** The bundled overlay fonts; `geist` is the app's own font. */
export const overlayFonts = ["geist", "quicksand", "space-grotesk", "oswald"] as const
export type OverlayFont = (typeof overlayFonts)[number]

/** How big the plates are drawn; `medium` is the size the overlay was designed at. */
export const overlaySizes = ["small", "medium", "large"] as const
export type OverlaySize = (typeof overlaySizes)[number]

/** The corner of the browser source the plates stack in. */
export const overlayPositions = ["top-left", "top-right", "bottom-left", "bottom-right"] as const
export type OverlayPosition = (typeof overlayPositions)[number]

export const overlayCorners = ["rounded", "square"] as const
export type OverlayCorners = (typeof overlayCorners)[number]

/** How a streamer's OBS overlay looks. Colors are `#rrggbb` in lowercase. */
export interface OverlayTheme {
  /** The giveaway code and the plate behind a winner's name. */
  readonly accent: string
  /** The plates. */
  readonly background: string
  /** Text on the plates. */
  readonly text: string
  readonly font: OverlayFont
  readonly size: OverlaySize
  readonly position: OverlayPosition
  readonly corners: OverlayCorners
  /** A short sound when a winner is revealed. */
  readonly sound: boolean
  /** Confetti when a winner is revealed; never under reduced motion. */
  readonly confetti: boolean
}

/** The overlay as it looked before themes; the colors are the `--accent`, `--overlay-plate` and `--overlay-ink` tokens of the web app. */
export const defaultOverlayTheme: OverlayTheme = {
  accent: "#a8dd2c",
  background: "#111113",
  text: "#fafafa",
  font: "geist",
  size: "medium",
  position: "top-left",
  corners: "rounded",
  sound: false,
  confetti: false,
}

export type OverlayThemeIssueCode =
  | "not-an-object"
  | "missing"
  | "not-a-color"
  | "unknown-option"
  | "not-a-boolean"

/** The first invalid field of untrusted theme input. */
export interface OverlayThemeIssue {
  readonly field: string
  readonly code: OverlayThemeIssueCode
}

/** Parses `theme_json` or a request body: every field must be present; an unknown one is dropped. */
export function parseOverlayTheme(input: unknown): Parsed<OverlayTheme, OverlayThemeIssue> {
  if (!isRecord(input)) return fail("theme", "not-an-object")
  const accent = parseColor(input, "accent")
  if (!accent.ok) return accent
  const background = parseColor(input, "background")
  if (!background.ok) return background
  const text = parseColor(input, "text")
  if (!text.ok) return text
  const font = parseOption(input, "font", overlayFonts)
  if (!font.ok) return font
  const size = parseOption(input, "size", overlaySizes)
  if (!size.ok) return size
  const position = parseOption(input, "position", overlayPositions)
  if (!position.ok) return position
  const corners = parseOption(input, "corners", overlayCorners)
  if (!corners.ok) return corners
  const sound = parseSwitch(input, "sound")
  if (!sound.ok) return sound
  const confetti = parseSwitch(input, "confetti")
  if (!confetti.ok) return confetti
  return {
    ok: true,
    value: {
      accent: accent.value,
      background: background.value,
      text: text.value,
      font: font.value,
      size: size.value,
      position: position.value,
      corners: corners.value,
      sound: sound.value,
      confetti: confetti.value,
    },
  }
}

// Only six hex digits: the value is written into a CSS custom property, so nothing else may get through.
const colorPattern = /^#[0-9a-f]{6}$/i

function parseColor(
  input: Record<string, unknown>,
  field: "accent" | "background" | "text",
): Parsed<string, OverlayThemeIssue> {
  const value = ownValue(input, field)
  if (value === undefined) return fail(field, "missing")
  if (typeof value !== "string" || !colorPattern.test(value)) return fail(field, "not-a-color")
  return { ok: true, value: value.toLowerCase() }
}

function parseOption<F extends "font" | "size" | "position" | "corners">(
  input: Record<string, unknown>,
  field: F,
  options: readonly OverlayTheme[F][],
): Parsed<OverlayTheme[F], OverlayThemeIssue> {
  const value = ownValue(input, field)
  if (value === undefined) return fail(field, "missing")
  const known = options.find((option) => option === value)
  return known === undefined ? fail(field, "unknown-option") : { ok: true, value: known }
}

function parseSwitch(
  input: Record<string, unknown>,
  field: "sound" | "confetti",
): Parsed<boolean, OverlayThemeIssue> {
  const value = ownValue(input, field)
  if (value === undefined) return fail(field, "missing")
  if (typeof value !== "boolean") return fail(field, "not-a-boolean")
  return { ok: true, value }
}

// Own properties only: a field name must not reach `constructor` or `__proto__`.
function ownValue(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function fail(field: string, code: OverlayThemeIssueCode): { ok: false; issue: OverlayThemeIssue } {
  return { ok: false, issue: { field, code } }
}
