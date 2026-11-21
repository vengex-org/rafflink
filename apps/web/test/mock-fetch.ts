import { spyOn } from "bun:test"

export interface Reply {
  readonly status: number
  readonly body: unknown
}

const signedOut: Reply = { status: 200, body: { streamer: null } }

/** Answers `fetch(path, init)` by "METHOD /path", after the route's promise when it returns one; a request nobody listed fails the test that made it. The header's session call is answered signed-out unless a route says otherwise. */
export function mockFetch(routes: Readonly<Record<string, () => Reply | Promise<Reply>>>) {
  const answers: Readonly<Record<string, () => Reply | Promise<Reply>>> = {
    "GET /api/session": () => signedOut,
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
