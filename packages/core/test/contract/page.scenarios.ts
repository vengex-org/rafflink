import { expect } from "bun:test"
import { users } from "./fake-twitch.ts"
import { inlineScriptSource } from "./spa-fixture.ts"
import type { ContractContext, ContractTarget } from "./target.ts"
import { scenario } from "./world.ts"

function page(target: ContractTarget, path: string): Promise<Response> {
  return fetch(new URL(path, target.url))
}

export function pageScenarios(context: ContractContext): void {
  scenario(
    context,
    "the home page carries the security headers and the hash of its inline script",
    async (world) => {
      const target = await world.start()

      const response = await page(target, "/")

      expect(response.status).toBe(200)
      expect(response.headers.get("content-security-policy")).toBe(
        `default-src 'self'; script-src 'self' ${inlineScriptSource}; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
      )
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin")
      expect(response.headers.get("permissions-policy")).toBe(
        "camera=(), microphone=(), geolocation=(), payment=()",
      )
      expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin")
      expect(response.headers.get("cache-control")).toBe("no-cache")
      expect(response.headers.get("x-robots-tag")).toBeNull()
    },
  )

  scenario(context, "the home page sends HSTS only where its origin is https", async (world) => {
    const target = await world.start()

    const response = await page(target, "/")

    // The static host always serves https; the server decides by PUBLIC_URL, which is http here.
    expect(response.headers.get("strict-transport-security")).toBe(
      context.pages === "static" ? "max-age=31536000; includeSubDomains" : null,
    )
  })

  scenario(
    context,
    "an unknown code and the streamer pages answer the plain page, not indexed",
    async (world) => {
      const target = await world.start()

      for (const path of ["/ZZZZZ", "/g/ZZZZZ", "/dashboard", "/live/x", "/admin", "/demo"]) {
        const response = await page(target, path)
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain("<title>Rafflink home</title>")
        expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow")
      }
    },
  )

  scenario(context, "an API path answers JSON with the security headers", async (world) => {
    const target = await world.start()

    const response = await page(target, "/api/g/XXXXX")

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "not-found" })
    expect(response.headers.get("content-security-policy")).toStartWith(
      "default-src 'self'; script-src 'self';",
    )
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
  })

  if (context.pages === "static") staticPageScenarios(context)
  else injectedPageScenarios(context)
}

function staticPageScenarios(context: ContractContext): void {
  scenario(
    context,
    "a giveaway link serves the generic page with static headers and no giveaway preview",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)

      for (const path of [`/g/${giveaway.code}`, `/${giveaway.code}`]) {
        const response = await page(target, path)
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain("<title>Rafflink home</title>")
        expect(html).not.toContain(users.streamer.displayName)
        expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow")
        expect(response.headers.get("content-security-policy")).toContain(inlineScriptSource)
      }
    },
  )
}

function injectedPageScenarios(context: ContractContext): void {
  scenario(
    context,
    "a giveaway link previews its title, prize and streamer and is not indexed",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target)

      for (const path of [`/g/${giveaway.code}`, `/${giveaway.code}`]) {
        const response = await page(target, path)
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain("<title>Giveaway</title>")
        expect(html).toContain(`<meta property="og:title" content="Giveaway" />`)
        expect(html).toContain(
          `<meta name="twitter:description" content="Win Prize from ${users.streamer.displayName}. Sign in with Twitch to join." />`,
        )
        expect(html).toContain(
          `<meta property="og:url" content="http://localhost/${giveaway.code}" />`,
        )
        expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow")
        expect(response.headers.get("content-security-policy")).toContain(inlineScriptSource)
      }
    },
  )

  scenario(
    context,
    "a giveaway without a title previews as Giveaway and its code",
    async (world) => {
      const target = await world.start()
      const giveaway = await world.createGiveaway(target, { unnamed: true })

      const html = await (await page(target, `/${giveaway.code}`)).text()

      expect(html).toContain(`<title>Giveaway ${giveaway.code}</title>`)
      expect(html).toContain(
        `content="Enter the giveaway of ${users.streamer.displayName}. Sign in with Twitch to join."`,
      )
    },
  )

  scenario(context, "the home page links its canonical URL from PUBLIC_URL", async (world) => {
    const target = await world.start()

    const html = await (await page(target, "/")).text()

    expect(html).toContain(`<link rel="canonical" href="http://localhost/" />`)
  })
}
