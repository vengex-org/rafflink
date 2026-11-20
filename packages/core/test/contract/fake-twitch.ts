import { createFakeTwitch, websocket, type FakeTwitch, type FakeUser } from "@rafflink/fake-twitch"

export const users = {
  streamer: user("200"),
  otherStreamer: user("201"),
  viewer: user("100"),
  viewer2: user("101"),
  viewer3: user("102"),
  newViewer: { ...user("103"), createdAt: new Date().toISOString() },
} as const

function user(id: string): FakeUser {
  return { id, login: `user_${id}`, displayName: `User_${id}`, createdAt: "2019-01-01T00:00:00Z" }
}

/** The app credentials the fake accepts; a target gets them as `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`. */
export const clientCredentials = { id: "client-1", secret: "secret-1" } as const

export interface RunningFakeTwitch {
  readonly fake: FakeTwitch
  readonly origin: string
  stop(): Promise<void>
}

/** The fake Twitch on its own port, knowing every user of {@link users}. */
export function startFakeTwitch(): RunningFakeTwitch {
  const fake = createFakeTwitch({
    clientId: clientCredentials.id,
    clientSecret: clientCredentials.secret,
    defaultUser: users.viewer,
    subscribeWindowMs: 300,
    keepaliveTimeoutSeconds: 10,
  })
  for (const fakeUser of Object.values(users)) fake.control.addUser(fakeUser)
  const server = Bun.serve({ port: 0, fetch: fake.app.fetch, websocket })
  return {
    fake,
    origin: server.url.origin,
    stop: async () => {
      await server.stop(true)
    },
  }
}
