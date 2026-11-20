/**
 * The most Twitch requests one queued code waits for in a row: the code exchange, the key set for the
 * id_token, the profile, then the follow and subscription reads side by side. Each of the last three
 * may be sent twice, because a Helix 503 is retried once.
 */
export const queuedEntryTwitchRequests = 6
