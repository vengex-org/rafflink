import type { SocketConnector, SocketHandlers, TextSocket } from "@rafflink/core/ports"

/**
 * Outbound WebSockets of a Durable Object: a `fetch` with `Upgrade: websocket`, whose response carries the
 * socket. A Worker `fetch` takes an `http(s)` URL for it.
 */
export class DurableObjectSocketConnector implements SocketConnector {
  open(url: string, handlers: SocketHandlers): TextSocket {
    let socket: WebSocket | null = null
    let closeRequested = false
    let ended = false
    const end = (cause: unknown): void => {
      if (ended) return
      ended = true
      handlers.onClose(cause)
    }
    void fetch(url.replace(/^ws/, "http"), { headers: { Upgrade: "websocket" } }).then(
      (response) => {
        const accepted = response.webSocket
        if (accepted === null) {
          end(new Error("the upgrade did not return a WebSocket"))
          return
        }
        accepted.accept()
        accepted.addEventListener("message", (event) => {
          if (typeof event.data === "string") handlers.onText(event.data)
        })
        accepted.addEventListener("error", (event) => end(event))
        accepted.addEventListener("close", () => end(undefined))
        socket = accepted
        if (closeRequested) accepted.close()
      },
      end,
    )
    return {
      close: () => {
        closeRequested = true
        socket?.close()
        if (socket === null) end(undefined)
      },
    }
  }
}
