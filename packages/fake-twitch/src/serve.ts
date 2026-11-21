import { websocket } from "@hono/bun"
import { createFakeTwitch } from "./fake-twitch.ts"
import type { FakeTwitchOptions, FakeUser } from "./state.ts"

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
  userPicker: true,
  // Twitch closes an EventSub socket that sends no subscription within 10 s, and allows keepalive timeouts from 10 s.
  subscribeWindowMs: 10_000,
  keepaliveTimeoutSeconds: 10,
}

/** Known besides the default user: a sign-in picks one with `login_hint=<id>` on `/oauth2/authorize`. */
export const devFakeTwitchUsers: readonly FakeUser[] = [
  {
    id: "1001",
    login: "fake_streamer",
    displayName: "Fake_Streamer",
    createdAt: "2020-01-01T00:00:00Z",
  },
]

/** `main.ts` seeds its users from this id up, so a client can sign them in with `login_hint`. */
export const seededUsersFirstId = 100_000

export function serveFakeTwitch(port: number, options: FakeTwitchOptions = devFakeTwitchOptions) {
  const { app, control } = createFakeTwitch(options)
  for (const user of devFakeTwitchUsers) control.addUser(user)
  const server = Bun.serve({ port, fetch: app.fetch, websocket })
  return { server, app, control }
}
