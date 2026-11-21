const twitchLogin = /^[A-Za-z0-9_]{1,25}$/

/** The channel page of a streamer; null when the name is not a Twitch login, because the giveaway holds the display name only. */
export function twitchChannelUrl(streamerName: string): string | null {
  return twitchLogin.test(streamerName)
    ? `https://www.twitch.tv/${streamerName.toLowerCase()}`
    : null
}
