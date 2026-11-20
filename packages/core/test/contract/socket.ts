import type { EntrantsDelta, LiveSnapshot } from "../../src/room/giveaway-room.ts"

/** A snapshot, with the new entrants when it is a push after a write. */
export type LiveMessage = LiveSnapshot & { readonly entrantsAfter?: EntrantsDelta }

/** A WebSocket to a live route that keeps every message it receives. */
export function openSocket(url: URL, headers: Record<string, string> = {}) {
  const messages: LiveMessage[] = []
  // Bun accepts a `headers` option that lib.dom's constructor type lacks.
  const socket: WebSocket = Reflect.construct(WebSocket, [
    url.href.replace(/^http/, "ws"),
    { headers },
  ])
  socket.addEventListener("message", (event) => {
    const message: LiveMessage = JSON.parse(String(event.data))
    messages.push(message)
  })
  return { socket, messages }
}
