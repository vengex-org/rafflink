import { assertLocalUrl } from "./local-host.ts"

/** A request that takes longer is a failed one; above the slowest answer of a healthy run, a starting guess. */
const requestTimeoutMs = 30_000

/**
 * A cookie jar over `fetch` for one viewer or streamer. Every URL passes {@link assertLocalUrl} before a
 * request goes out. Connections are reused: the contract suite's `Browser` closes each one, which at
 * hundreds of sign-ins per second exhausts the OS's ephemeral ports.
 */
export class LocalBrowser {
  private readonly cookies = new Map<string, string>()

  constructor(private readonly target: URL) {}

  /** A path on the target, with this browser's cookies. */
  get(path: string): Promise<Response> {
    return this.send(new URL(path, this.target), { withCookies: true })
  }

  postJson(path: string, body: unknown): Promise<Response> {
    return this.send(new URL(path, this.target), {
      withCookies: true,
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    })
  }

  /** Starts a sign-in at `startPath` and consents at the fake as `userId`; returns the target's callback path with its query. */
  async signInUntilCallback(startPath: string, userId: string): Promise<string> {
    const start = await this.get(startPath)
    const authorizeUrl = this.locationOf(start)
    authorizeUrl.searchParams.set("login_hint", userId)
    const authorize = await this.send(authorizeUrl, { withCookies: false })
    const callback = this.locationOf(authorize)
    return callback.pathname + callback.search
  }

  /** The `Location` of a redirect; throws when the answer is not one, naming its status. */
  locationOf(response: Response): URL {
    const location = response.headers.get("location")
    if (location === null) throw new RedirectMissing(response.status)
    return new URL(location, this.target)
  }

  private async send(
    url: URL,
    options: { withCookies: boolean; init?: RequestInit },
  ): Promise<Response> {
    assertLocalUrl(url.href)
    const headers = new Headers(options.init?.headers)
    if (options.withCookies && this.cookies.size > 0) headers.set("cookie", this.cookieHeader())
    const sent = await fetch(url, {
      ...options.init,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
    // A body left unread keeps its connection from going back to the pool, and a new one per sign-in exhausts the OS's ports.
    const response = new Response(await sent.arrayBuffer(), sent)
    if (options.withCookies)
      for (const setCookie of response.headers.getSetCookie()) this.store(setCookie)
    return response
  }

  private cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ")
  }

  private store(setCookie: string): void {
    const [pair = "", ...attributes] = setCookie.split(";").map((part) => part.trim())
    const separator = pair.indexOf("=")
    const name = pair.slice(0, separator)
    const value = pair.slice(separator + 1)
    const expired = attributes.some((attribute) => attribute.toLowerCase() === "max-age=0")
    if (expired || value === "") this.cookies.delete(name)
    else this.cookies.set(name, value)
  }
}

/** A step of the sign-in answered something other than a redirect; `status` says what. */
export class RedirectMissing extends Error {
  constructor(readonly status: number) {
    super(`expected a redirect, got HTTP ${status}`)
  }
}
