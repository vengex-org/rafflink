/** A Twitch login in any case: Twitch compares logins case-insensitively and stores them in lower case. */
export const twitchLoginPattern = /^[A-Za-z0-9_]{1,25}$/
