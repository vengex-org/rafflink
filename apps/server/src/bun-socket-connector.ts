import type { SocketConnector, SocketHandlers, TextSocket } from "@rafflink/core/ports"

/** Outbound WebSockets over Bun's global `WebSocket`. */
export class BunSocketConnector implements SocketConnector {
  open(url: string, handlers: SocketHandlers): TextSocket {
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch (cause) {
      // Handlers are not called before `open` returns.
      queueMicrotask(() => handlers.onClose(cause))
      return { close: () => {} }
    }
    let ended = false
    const end = (cause: unknown): void => {
      if (ended) return
      ended = true
      handlers.onClose(cause)
    }
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") handlers.onText(event.data)
    })
    socket.addEventListener("error", (event) => end(event))
    socket.addEventListener("close", () => end(undefined))
    return { close: () => socket.close() }
  }
}
