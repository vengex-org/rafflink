import { createFakeKick, type FakeKick, type FakeKickUser } from "@rafflink/fake-kick"

export const kickUsers = {
  streamer: kickUser("300", "Kick_Streamer"),
  viewer: kickUser("301", "Kick_Viewer"),
  viewer2: kickUser("302", "Kick_Viewer2"),
  viewer3: kickUser("303", "Kick_Viewer3"),
  viewer4: kickUser("304", "Kick_Viewer4"),
  viewer5: kickUser("305", "Kick_Viewer5"),
} as const

function kickUser(id: string, name: string): FakeKickUser {
  return { id, name }
}

/** The app credentials the fake accepts; a target gets them as `KICK_CLIENT_ID` and `KICK_CLIENT_SECRET`. */
export const kickClientCredentials = { id: "kick-client-1", secret: "kick-secret-1" } as const

export interface RunningFakeKick {
  readonly fake: FakeKick
  readonly origin: string
  stop(): Promise<void>
}

/** The fake Kick on its own port, knowing every user of {@link kickUsers}. */
export function startFakeKick(): RunningFakeKick {
  const fake = createFakeKick({
    clientId: kickClientCredentials.id,
    clientSecret: kickClientCredentials.secret,
    defaultUser: kickUsers.viewer,
  })
  for (const user of Object.values(kickUsers)) fake.control.addUser(user)
  const server = Bun.serve({ port: 0, fetch: fake.app.fetch })
  return {
    fake,
    origin: server.url.origin,
    stop: async () => {
      await server.stop(true)
    },
  }
}
