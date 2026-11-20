import type { LiveSnapshot } from "../../src/room/giveaway-room.ts"

/** A WebSocket to a live route that keeps every snapshot it receives. */
export function openSocket(url: URL, headers: Record<string, string> = {}) {
  const messages: LiveSnapshot[] = []
  // Bun accepts a `headers` option that lib.dom's constructor type lacks.
  const socket: WebSocket = Reflect.construct(WebSocket, [
    url.href.replace(/^http/, "ws"),
    { headers },
  ])
  socket.addEventListener("message", (event) => {
    const snapshot: LiveSnapshot = JSON.parse(String(event.data))
    messages.push(snapshot)
  })
  return { socket, messages }
}
