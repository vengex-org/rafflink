import type { ResolvedConfig } from "../config.ts"

export const viewerCallbackPath = "/auth/twitch/viewer"
export const streamerCallbackPath = "/auth/twitch/streamer"

/** The redirect URI registered with Twitch for a callback path; Twitch compares it byte for byte. */
export function redirectUri(config: Pick<ResolvedConfig, "publicUrl">, path: string): string {
  return new URL(path, config.publicUrl).toString()
}
