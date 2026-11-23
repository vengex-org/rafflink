/** Stands in for the browser WebSocket: the test pushes messages and closes the connection. */
export class FakeSocket {
  static readonly opened: FakeSocket[] = []
  private readonly listeners = new Map<string, ((event: Event) => void)[]>()
  closed = false
  /** What the page sent through the socket. */
  readonly sent: unknown[] = []

  constructor(readonly url: string) {
    FakeSocket.opened.push(this)
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  send(data: unknown): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
  }

  push(data: unknown): void {
    this.emit(new MessageEvent("message", { data: JSON.stringify(data) }))
  }

  open(): void {
    this.emit(new Event("open"))
  }

  drop(): void {
    this.emit(new Event("close"))
  }

  /** The server ended the socket because its peer lost access (RFC 6455 code 1008). */
  revoke(): void {
    this.emit(new CloseEvent("close", { code: 1008 }))
  }

  private emit(event: Event): void {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event)
  }
}

export function installFakeSocket(): () => void {
  const original = globalThis.WebSocket
  FakeSocket.opened.length = 0
  Reflect.set(globalThis, "WebSocket", FakeSocket)
  return () => Reflect.set(globalThis, "WebSocket", original)
}
