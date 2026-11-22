import { twitchLoginPattern } from "@rafflink/core/twitch/lib/login"

/** The channel page of a streamer; null when the name is not a Twitch login, because the giveaway holds the display name only. */
export function twitchChannelUrl(streamerName: string): string | null {
  return twitchLoginPattern.test(streamerName)
    ? `https://www.twitch.tv/${streamerName.toLowerCase()}`
    : null
}
