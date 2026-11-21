import { describe, expect, it } from "bun:test"
import { Hono } from "hono"
import {
  contentSecurityPolicy,
  securityHeaders,
  securityHeadersMiddleware,
} from "./security-headers.ts"

describe("securityHeaders", () => {
  it("sends every header and no HSTS without https", () => {
    const headers = securityHeaders({ hsts: false, scriptHashes: [] })

    expect(Object.keys(headers)).toEqual([
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Cross-Origin-Opener-Policy",
    ])
  })

  it("adds HSTS with https", () => {
    expect(securityHeaders({ hsts: true, scriptHashes: [] })["Strict-Transport-Security"]).toBe(
      "max-age=31536000; includeSubDomains",
    )
  })

  it("allows each script hash in script-src and nothing inline in style-src", () => {
    const policy = contentSecurityPolicy(["sha256-a", "sha256-b"])

    expect(policy).toContain("script-src 'self' 'sha256-a' 'sha256-b';")
    expect(policy).toContain("style-src 'self';")
    expect(policy).toContain("frame-ancestors 'none'")
  })

  it("lets the page read the public drand APIs and no other origin", () => {
    expect(contentSecurityPolicy([])).toContain(
      "connect-src 'self' https://api.drand.sh https://drand.cloudflare.com;",
    )
  })
})

function appOn(publicUrl: string): Hono {
  const app = new Hono()
  app.use(securityHeadersMiddleware({ publicUrl }))
  app.get("/json", (c) => c.json({ ok: true }))
  app.get("/page", (c) => c.text("page", 200, { "Content-Security-Policy": "own" }))
  return app
}

describe("securityHeadersMiddleware", () => {
  it("sets the headers on a response and keeps a CSP the handler set", async () => {
    const app = appOn("http://localhost")

    const json = await app.request("/json")
    const page = await app.request("/page")

    expect(json.headers.get("content-security-policy")).toStartWith("default-src 'self'")
    expect(json.headers.get("x-content-type-options")).toBe("nosniff")
    expect(page.headers.get("content-security-policy")).toBe("own")
  })

  it("sends HSTS only when the public URL is https", async () => {
    const plain = await appOn("http://localhost").request("/json")
    const secure = await appOn("https://rafflink.example").request("/json")

    expect(plain.headers.get("strict-transport-security")).toBeNull()
    expect(secure.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    )
  })

  it("covers a 404 that has no handler", async () => {
    const response = await appOn("http://localhost").request("/missing")

    expect(response.status).toBe(404)
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin")
  })
})
