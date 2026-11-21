import type { I18n } from "../i18n/i18n.tsx"

/** What a giveaway is called on screen; the streamer may leave the title empty. */
export function giveawayName(i18n: I18n, title: string | null, code: string): string {
  return title ?? i18n.t("giveaway.fallbackName", { code })
}

/**
 * What a giveaway is listed under in the streamer's views and on stream: its title, else its prize, else
 * "Giveaway CODE". A screen that does not know the prize passes null and falls back to the code.
 */
export function giveawayDisplayName(
  i18n: I18n,
  giveaway: { readonly title: string | null; readonly prize: string | null; readonly code: string },
): string {
  return giveaway.title ?? giveaway.prize ?? giveawayName(i18n, null, giveaway.code)
}
