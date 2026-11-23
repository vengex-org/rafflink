import { expect } from "bun:test"
import type { AdminStatsJson } from "../../src/http/json.ts"
import type { Browser } from "./browser.ts"
import { users } from "./fake-twitch.ts"
import type { ContractTarget, ContractContext } from "./target.ts"
import { publicOrigin, scenario, type World } from "./world.ts"

const upgrade = { upgrade: "websocket", connection: "Upgrade" }

export function presenceScenarios(context: ContractContext): void {
  scenario(
    context,
    "an admin sees the open pages of the site per kind, and a closed page leaves the count",
    async (world) => {
      const target = await world.start()
      const admin = await world.signInStreamer(target, users.streamer.id)

      const home = openPresence(world, target, "home")
      openPresence(world, target, "home")
      openPresence(world, target, "giveaway")
      await waitForPresence(world, admin, 3)
      const opened = await presence(admin)
      home.close()
      await waitForPresence(world, admin, 2)

      expect(opened).toEqual({
        total: 3,
        byKind: { home: 2, legal: 0, dashboard: 0, giveaway: 1, other: 0 },
      })
      expect(await presence(admin)).toMatchObject({ byKind: { home: 1, giveaway: 1 } })
    },
  )

  scenario(
    context,
    "a presence socket from another origin or with an unknown kind is refused",
    async (world) => {
      const target = await world.start()
      const url = (kind: string) => new URL(`/api/presence?kind=${kind}`, target.url)

      const evil = await fetch(url("home"), {
        headers: { ...upgrade, origin: "https://evil.example" },
      })
      const unknown = await fetch(url("overlay"), { headers: { ...upgrade, origin: publicOrigin } })

      expect([evil.status, unknown.status]).toEqual([403, 400])
    },
  )
}

function openPresence(world: World, target: ContractTarget, kind: string): WebSocket {
  return world.openSocket(new URL(`/api/presence?kind=${kind}`, target.url), {
    origin: publicOrigin,
  }).socket
}

// `fresh=1` skips the admin statistics' short-lived copy, so each read counts the sockets again.
async function presence(admin: Browser): Promise<AdminStatsJson["presence"]> {
  const stats: AdminStatsJson = await (await admin.request("/api/admin/stats?fresh=1")).json()
  return stats.presence
}

function waitForPresence(world: World, admin: Browser, total: number): Promise<void> {
  return world.waitFor(async () => {
    const counts = await presence(admin)
    return counts !== "unavailable" && counts.total === total
  }, `${total} open pages`)
}
