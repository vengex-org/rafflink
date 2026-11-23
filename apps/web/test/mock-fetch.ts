import { spyOn } from "bun:test"
import { defaultOverlayTheme } from "@rafflink/core/domain/overlay-theme"

export interface Reply {
  readonly status: number
  readonly body: unknown
}

const signedOut: Reply = {
  status: 200,
  body: { streamer: null, signInPlatforms: ["twitch"], donateUrl: null, operator: null },
}
const noBadges: Reply = { status: 200, body: { sub_t1: null, sub_t2: null, sub_t3: null } }
const defaultTheme: Reply = { status: 200, body: { theme: defaultOverlayTheme } }

const noBlocks: Reply = { status: 200, body: { blocks: [], blockListMax: 100 } }
const noChannelPoints: Reply = { status: 200, body: { kind: "no-channel-points" } }

/** Answers `fetch(path, init)` by "METHOD /path", after the route's promise when it returns one; a request nobody listed fails the test that made it. The header's session call is answered signed-out, the live page's badges call with no badges, the overlay's theme call with the default theme, the dashboard's block list call with an empty list and the wizard's reward list with no channel points unless a route says otherwise. */
export function mockFetch(routes: Readonly<Record<string, () => Reply | Promise<Reply>>>) {
  const answers: Readonly<Record<string, () => Reply | Promise<Reply>>> = {
    "GET /api/session": () => signedOut,
    "GET /api/live/gid-1/badges": () => noBadges,
    "GET /api/overlay/gid-1/tok-1/theme": () => defaultTheme,
    "GET /api/dash/blocks": () => noBlocks,
    "GET /api/dash/rewards": () => noChannelPoints,
    ...routes,
  }
  const requests: { readonly route: string; readonly body: unknown }[] = []
  const answerRequest = async (input: string | URL | Request, init?: RequestInit) => {
    if (typeof input !== "string") throw new Error("the client fetches by path")
    const route = `${init?.method ?? "GET"} ${input}`
    const answer = answers[route]
    if (answer === undefined) throw new Error(`unexpected request ${route}`)
    requests.push({ route, body: typeof init?.body === "string" ? JSON.parse(init.body) : null })
    const { status, body } = await answer()
    return status === 204 ? new Response(null, { status }) : Response.json(body, { status })
  }
  // lib.dom's fetch type has no `preconnect`, Bun's has; the client never calls it.
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(answerRequest, { preconnect: () => {} }),
  )
  return requests
}

export const ok = (body: unknown): Reply => ({ status: 200, body })
