import { Hono, type Context } from "hono"
import type { StreamerRecord } from "../accounts/account-store.ts"
import { canCreateGiveaways } from "../accounts/streamer-access.ts"
import type { ResolvedConfig } from "../config.ts"
import { providerFor } from "../platform/provider.ts"
import type { AppDeps } from "./deps.ts"
import type { OperatorJson, SessionJson } from "./json.ts"
import { endStreamerSession, readStreamerSession, type StreamerSession } from "./session.ts"
import { sameOrigin } from "./origin.ts"

export function sessionRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.get("/api/session", async (c) => {
    c.header("Cache-Control", "no-store")
    const current = await currentStreamer(c, deps)
    const body: SessionJson = {
      streamer:
        current === null
          ? null
          : {
              displayName: current.streamer.displayName,
              login: current.streamer.login,
              profileImageUrl: current.streamer.profileImageUrl,
              canCreate: await canCreateGiveaways(deps.config, deps.admins, current.streamer),
              platform: current.streamer.platform,
              capabilities: providerFor(deps.platforms, current.streamer.platform).capabilities,
            },
      donateUrl: deps.config.donateUrl,
      operator: operatorOf(deps.config),
    }
    return c.json(body)
  })

  app.post("/auth/logout", sameOrigin(deps.config), (c) => {
    endStreamerSession(c)
    return c.body(null, 204)
  })

  return app
}

function operatorOf(config: ResolvedConfig): OperatorJson | null {
  // resolveConfig sets the e-mail whenever it sets the name.
  if (config.operatorName === null || config.operatorEmail === null) return null
  return {
    name: config.operatorName,
    address: config.operatorAddress,
    id: config.operatorId,
    email: config.operatorEmail,
    legalUpdated: config.legalUpdated,
  }
}

/**
 * The signed-in streamer: a valid cookie whose streamer still exists. A cookie of a streamer that is
 * gone is deleted, so the browser stops sending it.
 */
export async function currentStreamer(
  c: Context,
  deps: AppDeps,
): Promise<{ session: StreamerSession; streamer: StreamerRecord } | null> {
  const session = await readStreamerSession(c, deps)
  if (session === null) return null
  const streamer = await deps.accounts.findStreamer(session.streamerId)
  if (streamer === null) {
    endStreamerSession(c)
    return null
  }
  return { session, streamer }
}
