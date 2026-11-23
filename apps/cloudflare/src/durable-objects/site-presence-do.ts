import { DurableObject } from "cloudflare:workers"
import { presenceCountsOf, presenceKindHeader } from "@rafflink/core/presence/site-presence"
import type { WorkerEnv } from "../env.ts"

/**
 * The one presence object of the deployment: each open page of the site is a hibernating WebSocket tagged
 * with its page kind, and the counts are the sockets per tag. It stores nothing and sends nothing, and a
 * page sends nothing either, so a hibernated socket costs no CPU and a visit costs the one upgrade request.
 */
export class SitePresenceObject extends DurableObject<WorkerEnv> {
  async counts() {
    return presenceCountsOf((kind) => this.ctx.getWebSockets(kind).length)
  }

  /** Accepts a page's socket, tagged with the kind the presence route of core named in a header. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a WebSocket upgrade", { status: 426 })
    }
    const kind = request.headers.get(presenceKindHeader)
    if (kind === null) return new Response("expected a page kind", { status: 400 })
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1], [kind])
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  override webSocketClose(socket: WebSocket, code: number): void {
    // 1005 and 1006 only describe a close; they are not codes a close frame may carry.
    socket.close(code === 1005 || code === 1006 ? 1000 : code)
  }
}
