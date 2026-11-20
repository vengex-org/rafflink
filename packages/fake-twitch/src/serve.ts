import { websocket } from "@hono/bun"
import { createFakeTwitch } from "./fake-twitch.ts"
import type { FakeTwitchOptions } from "./state.ts"

/** Client id and secret a local Rafflink points at while it runs against the fake. */
export const devFakeTwitchOptions: FakeTwitchOptions = {
  clientId: "fake-client-id",
  clientSecret: "fake-client-secret",
  defaultUser: {
    id: "1000",
    login: "fake_viewer",
    displayName: "Fake_Viewer",
    createdAt: "2020-01-01T00:00:00Z",
  },
  // Twitch closes an EventSub socket that sends no subscription within 10 s, and allows keepalive timeouts from 10 s.
  subscribeWindowMs: 10_000,
  keepaliveTimeoutSeconds: 10,
}

export function serveFakeTwitch(port: number, options: FakeTwitchOptions = devFakeTwitchOptions) {
  const { app, control } = createFakeTwitch(options)
  const server = Bun.serve({ port, fetch: app.fetch, websocket })
  return { server, app, control }
}
