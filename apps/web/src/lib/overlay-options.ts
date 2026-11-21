/**
 * `auto`: the entry link and count while people join, then a big plate per winner.
 * `compact`: the same corner badge after the draw, with the winner name in place of the link.
 * `winner`: nothing until the draw, then the big plate only.
 */
export const overlayModes = ["auto", "compact", "winner"] as const
export type OverlayMode = (typeof overlayModes)[number]

/** What an overlay link asks for: `?mode=` and `?qr=1`. */
export interface OverlayOptions {
  readonly mode: OverlayMode
  readonly qr: boolean
}

/** A missing or unknown mode is `auto`; only `qr=1` turns the QR code on. */
export function readOverlayOptions(params: URLSearchParams): OverlayOptions {
  const mode = params.get("mode")
  return {
    mode: overlayModes.find((known) => known === mode) ?? "auto",
    qr: params.get("qr") === "1",
  }
}

/** The overlay URL with the options that differ from the defaults. */
export function withOverlayOptions(url: string, { mode, qr }: OverlayOptions): string {
  const next = new URL(url)
  if (mode !== "auto") next.searchParams.set("mode", mode)
  if (qr) next.searchParams.set("qr", "1")
  return next.href
}
