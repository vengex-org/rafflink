import type { ResolvedConfig } from "../config.ts"
import type { OAuthFlow, Platform } from "./provider.ts"

/** Where a platform sends the browser back after its sign-in page; `/auth/twitch/streamer` for Twitch's streamer flow. */
export function callbackPath(platform: Platform, flow: OAuthFlow): string {
  // The Google client's redirect URI as the README registers it; YouTube signs in streamers only.
  if (platform === "youtube") return "/auth/youtube/callback"
  return `/auth/${platform}/${flow}`
}

/** The redirect URI registered with the platform for a callback path; Twitch compares it byte for byte. */
export function redirectUri(config: Pick<ResolvedConfig, "publicUrl">, path: string): string {
  return new URL(path, config.publicUrl).toString()
}
