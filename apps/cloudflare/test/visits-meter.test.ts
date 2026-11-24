import { describe, expect, it } from "bun:test"
import { resolveConfig } from "@rafflink/core/config"
import { UsageUnavailable } from "@rafflink/core/lib/usage-unavailable"
import type { Clock } from "@rafflink/core/ports"
import type { UsageFetch } from "../src/adapters/cloudflare-usage-meter.ts"
import { createVisitsMeter } from "../src/adapters/cloudflare-visits-meter.ts"

const clock: Clock = { now: () => Date.parse("2026-11-20T13:45:30.000Z") }

const required = {
  TWITCH_CLIENT_ID: "client",
  TWITCH_CLIENT_SECRET: "secret",
  TOKEN_SEAL_KEYS: "k",
  SESSION_SECRET: "session",
  ADMIN_TWITCH_IDS: "1",
  PUBLIC_URL: "https://rafflink.app",
}

const day = (date: string) => Date.parse(`${date}T00:00:00Z`)

describe("visits meter on the Cloudflare zone analytics", () => {
  it("maps the daily groups to one entry per day, a day without a row being zero", async () => {
    const requests: { readonly authorization: string | null; readonly body: unknown }[] = []
    const answer: UsageFetch = async (_url, init) => {
      requests.push({
        authorization: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)),
      })
      return Response.json({
        data: {
          viewer: {
            zones: [
              {
                days: [
                  {
                    dimensions: { date: "2026-11-18" },
                    sum: { pageViews: 120 },
                    uniq: { uniques: 45 },
                  },
                  {
                    dimensions: { date: "2026-11-20" },
                    sum: { pageViews: 80 },
                    uniq: { uniques: 30 },
                  },
                ],
              },
            ],
          },
        },
        errors: null,
      })
    }
    const config = resolveConfig({
      ...required,
      CLOUDFLARE_ZONE_ID: "zone-1",
      CLOUDFLARE_API_TOKEN: "token-1",
    })

    const visits = await createVisitsMeter(config, clock, answer).lastDays(4)

    expect(visits).toEqual([
      { day: day("2026-11-17"), pageViews: 0, uniqueVisitors: 0 },
      { day: day("2026-11-18"), pageViews: 120, uniqueVisitors: 45 },
      { day: day("2026-11-19"), pageViews: 0, uniqueVisitors: 0 },
      { day: day("2026-11-20"), pageViews: 80, uniqueVisitors: 30 },
    ])
    expect(requests).toMatchObject([
      {
        authorization: "Bearer token-1",
        body: {
          variables: { zoneTag: "zone-1", since: "2026-11-17", until: "2026-11-20", days: 4 },
        },
      },
    ])
  })

  it("reports a missing zone without asking Cloudflare, and a refused token, as unavailable", async () => {
    let asked = false
    const refused: UsageFetch = async () => {
      asked = true
      return Response.json({
        data: { viewer: { zones: [] } },
        errors: [{ message: "does not have access to the path", extensions: { code: "authz" } }],
      })
    }
    const withoutZone = resolveConfig({ ...required, CLOUDFLARE_API_TOKEN: "token-1" })
    const withZone = resolveConfig({
      ...required,
      CLOUDFLARE_ZONE_ID: "zone-1",
      CLOUDFLARE_API_TOKEN: "token-1",
    })

    await expect(
      createVisitsMeter(withoutZone, clock, refused).lastDays(30),
    ).rejects.toBeInstanceOf(UsageUnavailable)
    expect(asked).toBe(false)
    await expect(createVisitsMeter(withZone, clock, refused).lastDays(30)).rejects.toBeInstanceOf(
      UsageUnavailable,
    )
  })
})
