/**
 * The most Twitch requests one queued code waits for in a row: the code exchange, the key set for the
 * id_token, the profile, then the follow and subscription reads side by side. Each of the last three
 * may be sent twice, because a Helix 503 is retried once.
 */
export const queuedEntryTwitchRequests = 6

/**
 * The most Twitch requests one queued code sends in total: the same requests as above, with the follow
 * and subscription reads counted apart. On Cloudflare each is one external subrequest.
 */
export const queuedEntryTwitchSubrequests = 8
