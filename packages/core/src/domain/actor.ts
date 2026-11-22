/** Who pressed a room action: the streamer on their own live page, or whoever holds the moderator link with that id. */
export type Actor = "streamer" | `mod:${string}`

/** The actor of a moderator link. */
export function moderatorActor(linkId: string): Actor {
  return `mod:${linkId}`
}

/** `text` when it is an actor the room writes, otherwise null. */
export function parseActor(text: string): Actor | null {
  if (text === "streamer") return text
  return text.startsWith("mod:") && text.length > "mod:".length
    ? moderatorActor(text.slice(4))
    : null
}
