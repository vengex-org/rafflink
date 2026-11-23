import type { FakeKickOptions, FakeKickUser } from "./state.ts"

/** The fake a local Rafflink signs in with; the server's `KICK_CLIENT_ID` and `KICK_CLIENT_SECRET` become its app. */
export const devFakeKickOptions: Omit<FakeKickOptions, "clientId" | "clientSecret"> = {
  defaultUser: { id: "2000", name: "Fake_Kick_Viewer" },
  userPicker: true,
}

/** Known besides the default user: a sign-in picks one with `login_hint=<id>` on `/oauth/authorize`. */
export const devFakeKickUsers: readonly FakeKickUser[] = [
  { id: "2001", name: "Fake_Kick_Streamer" },
]
