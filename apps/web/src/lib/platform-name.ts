import type { Platform } from "@rafflink/core/platform/provider"

/** The brand name of each platform, written the same in every language. */
export const platformNames: Readonly<Record<Platform, string>> = {
  twitch: "Twitch",
  kick: "Kick",
  youtube: "YouTube",
}
