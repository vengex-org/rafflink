import type { FakeTwitchControl } from "@rafflink/fake-twitch"
import type { ContractTarget } from "./target.ts"

type SignInControl = Pick<FakeTwitchControl, "signInAs">

/** A cookie jar over `fetch` that follows the sign-in redirects between the target and the fake Twitch by hand. */
export class Browser {
  private readonly cookies = new Map<string, string>()

  private readonly base: URL
  private readonly keepalive: boolean

  constructor(target: Pick<ContractTarget, "url" | "reusesConnections">) {
    this.base = target.url
    this.keepalive = target.reusesConnections
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    const cookie = this.cookieHeader()
    if (cookie !== "") headers.set("cookie", cookie)
    const response = await fetch(new URL(path, this.base), {
      ...init,
      headers,
      redirect: "manual",
      keepalive: this.keepalive,
    })
    for (const setCookie of response.headers.getSetCookie()) this.store(setCookie)
    return response
  }

  postJson(path: string, body: unknown): Promise<Response> {
    return this.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ")
  }

  /** Starts a sign-in at `startPath`; returns the authorize URL the target redirected to. */
  async beginSignIn(startPath: string): Promise<URL> {
    const start = await this.request(startPath)
    return new URL(start.headers.get("location") ?? "")
  }

  /** Consents at the fake as `userId`; returns the callback URL the fake answers with. A test may edit `authorizeUrl` first. */
  async consent(authorizeUrl: URL, userId: string, twitch: SignInControl): Promise<URL> {
    twitch.signInAs(userId)
    const authorize = await fetch(authorizeUrl, { redirect: "manual" })
    return new URL(authorize.headers.get("location") ?? "")
  }

  finishSignIn(callback: URL, headers: HeadersInit = {}): Promise<Response> {
    return this.request(callback.pathname + callback.search, { headers })
  }

  /** A whole sign-in: start, consent as `userId`, callback, which carries `callbackHeaders`. Returns the callback response. */
  async signInAs(
    userId: string,
    startPath: string,
    twitch: SignInControl,
    callbackHeaders: HeadersInit = {},
  ): Promise<Response> {
    const authorizeUrl = await this.beginSignIn(startPath)
    return this.finishSignIn(await this.consent(authorizeUrl, userId, twitch), callbackHeaders)
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
