import type { RunningFakeTwitch } from "./fake-twitch.ts"

/** A cookie jar over `fetch` that follows the sign-in redirects between the server and the fake Twitch by hand. */
export class Browser {
  private readonly cookies = new Map<string, string>()

  constructor(private readonly base: URL) {}

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    const cookie = this.cookieHeader()
    if (cookie !== "") headers.set("cookie", cookie)
    const response = await fetch(new URL(path, this.base), {
      ...init,
      headers,
      redirect: "manual",
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

  /** Starts a sign-in at `startPath`, consents as `userId` at the fake, and finishes at the server's callback. */
  async signInAs(userId: string, startPath: string, twitch: RunningFakeTwitch): Promise<Response> {
    twitch.fake.control.signInAs(userId)
    const start = await this.request(startPath)
    const authorize = await fetch(start.headers.get("location") ?? "", { redirect: "manual" })
    const callback = new URL(authorize.headers.get("location") ?? "")
    return this.request(callback.pathname + callback.search)
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
