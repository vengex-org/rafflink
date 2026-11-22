/** Who pressed a room action: the streamer on their own live page, or whoever holds the moderator link with that id. */
export type Actor = "streamer" | `mod:${string}`

const moderatorPrefix = "mod:"

/** The actor of a moderator link. */
export function moderatorActor(linkId: string): Actor {
  return `${moderatorPrefix}${linkId}`
}

/** The moderator link of an actor, null for the streamer. */
export function actorLinkId(actor: Actor): string | null {
  return actor === "streamer" ? null : actor.slice(moderatorPrefix.length)
}

/** `text` when it is an actor the room writes, otherwise null. */
export function parseActor(text: string): Actor | null {
  if (text === "streamer") return text
  return text.startsWith(moderatorPrefix) && text.length > moderatorPrefix.length
    ? moderatorActor(text.slice(moderatorPrefix.length))
    : null
}
