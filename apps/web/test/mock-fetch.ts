import { spyOn } from "bun:test"

export interface Reply {
  readonly status: number
  readonly body: unknown
}

/** Answers `fetch(path, init)` by "METHOD /path"; a request nobody listed fails the test that made it. */
export function mockFetch(routes: Readonly<Record<string, () => Reply>>) {
  const requests: { readonly route: string; readonly body: unknown }[] = []
  const answerRequest = async (input: string | URL | Request, init?: RequestInit) => {
    if (typeof input !== "string") throw new Error("the client fetches by path")
    const route = `${init?.method ?? "GET"} ${input}`
    const answer = routes[route]
    if (answer === undefined) throw new Error(`unexpected request ${route}`)
    requests.push({ route, body: typeof init?.body === "string" ? JSON.parse(init.body) : null })
    const { status, body } = answer()
    return Response.json(body, { status })
  }
  // lib.dom's fetch type has no `preconnect`, Bun's has; the client never calls it.
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(answerRequest, { preconnect: () => {} }),
  )
  return requests
}

export const ok = (body: unknown): Reply => ({ status: 200, body })
