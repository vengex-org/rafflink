import { afterEach, describe, expect, it } from "bun:test"
import { resolveConfig } from "@rafflink/core/config"
import type { Clock } from "@rafflink/core/ports"
import { createUsageMeter, UsageUnavailable } from "../src/adapters/cloudflare-usage-meter.ts"

const clock: Clock = { now: () => Date.parse("2026-11-20T13:45:30.000Z") }

const required = {
  TWITCH_CLIENT_ID: "client",
  TWITCH_CLIENT_SECRET: "secret",
  TOKEN_SEAL_KEYS: "k",
  SESSION_SECRET: "session",
  ADMIN_TWITCH_IDS: "1",
  PUBLIC_URL: "https://rafflink.app",
}

const analytics = (workers: unknown, durableObjects: unknown) => ({
  data: { viewer: { accounts: [{ workers, durableObjects }] } },
  errors: null,
})

interface FakeAnalytics {
  readonly url: string
  readonly requests: { readonly authorization: string | null; readonly body: unknown }[]
}

let servers: ReturnType<typeof Bun.serve>[] = []

afterEach(async () => {
  await Promise.all(servers.map((server) => server.stop(true)))
  servers = []
})

/** A GraphQL endpoint on the host that answers every request with `answer`. */
function fakeAnalytics(answer: () => Response | Promise<Response>): FakeAnalytics {
  const requests: FakeAnalytics["requests"][number][] = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      requests.push({
        authorization: request.headers.get("authorization"),
        body: await request.json(),
      })
      return answer()
    },
  })
  servers.push(server)
  return { url: new URL("/client/v4/graphql", server.url).href, requests }
}

function meterFor(endpoint: FakeAnalytics, env: Record<string, string> = {}) {
  const config = resolveConfig({
    ...required,
    CLOUDFLARE_ACCOUNT_ID: "account-1",
    CLOUDFLARE_API_TOKEN: "token-1",
    CLOUDFLARE_USAGE_URL: endpoint.url,
    ...env,
  })
  return createUsageMeter(config, clock, fetch)
}

describe("usage meter on the Cloudflare Analytics API", () => {
  it("sums today's worker requests from the Analytics response", async () => {
    const analyticsServer = fakeAnalytics(() =>
      Response.json(analytics([{ sum: { requests: 61_234 } }], [{ sum: { requests: 4_321 } }])),
    )

    const usage = await meterFor(analyticsServer, { WORKER_REQUEST_LIMIT: "90000" }).today()

    expect(usage).toEqual({
      workerRequests: { used: 61_234, limit: 90_000 },
      doRequests: { used: 4_321, limit: 100_000 },
    })
    expect(analyticsServer.requests).toHaveLength(1)
    expect(analyticsServer.requests[0]).toMatchObject({
      authorization: "Bearer token-1",
      body: {
        variables: {
          accountTag: "account-1",
          since: "2026-11-20T00:00:00.000Z",
          until: "2026-11-20T13:45:30.000Z",
        },
      },
    })
  })

  it("counts a day without requests as zero used", async () => {
    const endpoint = fakeAnalytics(() => Response.json(analytics([], [])))

    expect(await meterFor(endpoint).today()).toMatchObject({
      workerRequests: { used: 0 },
      doRequests: { used: 0 },
    })
  })

  it("reports an Analytics error response as unavailable", async () => {
    const endpoint = fakeAnalytics(() =>
      Response.json({ data: null, errors: [{ message: "not authorized" }] }),
    )

    await expect(meterFor(endpoint).today()).rejects.toBeInstanceOf(UsageUnavailable)
  })

  it("reports an HTTP failure and a body that is not JSON as unavailable", async () => {
    const failing = fakeAnalytics(() => new Response("down", { status: 503 }))
    const garbled = fakeAnalytics(() => new Response("<html>", { status: 200 }))

    await expect(meterFor(failing).today()).rejects.toBeInstanceOf(UsageUnavailable)
    await expect(meterFor(garbled).today()).rejects.toBeInstanceOf(UsageUnavailable)
  })

  it("reports a request count that is not a non-negative integer as unavailable", async () => {
    for (const requests of [-1, 1.5, "12", null, Number.NaN]) {
      const endpoint = fakeAnalytics(() =>
        Response.json(analytics([{ sum: { requests } }], [{ sum: { requests: 0 } }])),
      )
      await expect(meterFor(endpoint).today()).rejects.toBeInstanceOf(UsageUnavailable)
    }
  })

  it("reports an answer without the account as unavailable", async () => {
    const endpoint = fakeAnalytics(() =>
      Response.json({ data: { viewer: { accounts: [] } }, errors: null }),
    )

    await expect(meterFor(endpoint).today()).rejects.toBeInstanceOf(UsageUnavailable)
  })

  it("gives up when Analytics does not answer within the timeout", async () => {
    const endpoint = fakeAnalytics(() => new Promise<Response>(() => {}))

    await expect(
      meterFor(endpoint, { CLOUDFLARE_USAGE_TIMEOUT_MS: "50" }).today(),
    ).rejects.toBeInstanceOf(UsageUnavailable)
  })

  it("reports no limit and calls nothing while the account id or token is unset", async () => {
    const endpoint = fakeAnalytics(() => Response.json(analytics([], [])))
    const config = resolveConfig({ ...required, CLOUDFLARE_USAGE_URL: endpoint.url })

    expect(await createUsageMeter(config, clock, fetch).today()).toBeNull()
    expect(await meterFor(endpoint, { CLOUDFLARE_API_TOKEN: "" }).today()).toBeNull()
    expect(endpoint.requests).toHaveLength(0)
  })
})
