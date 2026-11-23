import { Hono } from "hono"
import { configuredProviders } from "../platform/provider.ts"
import type { AppDeps } from "./deps.ts"

/** The webhook of each platform that sends chat by webhook, at `/api/<platform>/webhook`; the provider checks who sent it. */
export function webhookRoutes(deps: AppDeps): Hono {
  const app = new Hono()
  for (const provider of configuredProviders(deps.platforms)) {
    const receive = provider.receiveWebhook
    if (receive === undefined) continue
    app.post(`/api/${provider.platform}/webhook`, (c) =>
      receive(c.req.raw, (giveawayId, message) => deps.rooms.get(giveawayId).receiveChat(message)),
    )
  }
  return app
}
