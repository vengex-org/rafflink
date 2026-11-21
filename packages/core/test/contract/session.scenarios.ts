import { expect } from "bun:test"
import { Browser } from "./browser.ts"
import { users } from "./fake-twitch.ts"
import type { ContractContext } from "./target.ts"
import { publicOrigin, scenario } from "./world.ts"

export function sessionScenarios(context: ContractContext): void {
  scenario(context, "a browser without a session sees a null streamer", async (world) => {
    const target = await world.start()

    const response = await new Browser(target.url).request("/api/session")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ streamer: null })
  })

  scenario(context, "the session names the signed-in streamer", async (world) => {
    const target = await world.start()
    const streamer = await world.signInStreamer(target)

    const response = await streamer.request("/api/session")

    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({
      streamer: {
        displayName: users.streamer.displayName,
        login: users.streamer.login,
        profileImageUrl: users.streamer.profileImageUrl,
      },
    })
  })

  scenario(context, "logout deletes the streamer cookie", async (world) => {
    const target = await world.start()
    const streamer = await world.signInStreamer(target)

    const response = await streamer.request("/auth/logout", {
      method: "POST",
      headers: { origin: publicOrigin },
    })

    expect(response.status).toBe(204)
    expect(response.headers.getSetCookie().some((c) => c.startsWith("rl_streamer=;"))).toBe(true)
    expect(await (await streamer.request("/api/session")).json()).toEqual({ streamer: null })
  })

  scenario(
    context,
    "logout from another origin is refused and keeps the session",
    async (world) => {
      const target = await world.start()
      const streamer = await world.signInStreamer(target)

      const response = await streamer.request("/auth/logout", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      })

      expect(response.status).toBe(403)
      expect((await (await streamer.request("/api/session")).json()).streamer).not.toBeNull()
    },
  )
}
