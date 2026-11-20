import type { I18n } from "../i18n/i18n.tsx"

/** What a giveaway is called on screen; the streamer may leave the title empty. */
export function giveawayName(i18n: I18n, title: string | null, code: string): string {
  return title ?? i18n.t("giveaway.fallbackName", { code })
}
