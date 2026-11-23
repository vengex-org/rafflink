import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderSpaHtml } from "../packages/core/src/lib/spa-html.ts"
import { contractParts } from "../packages/core/test/contract/define-contract.ts"

const root = new URL("../", import.meta.url)
const web = new URL("apps/web/", root)
const dist = new URL("dist/", web)

let built = false

function buildWeb(): void {
  if (built) return
  const build = Bun.spawnSync(["bun", "run", "build"], { cwd: fileURLToPath(web) })
  expect(build.exitCode).toBe(0)
  built = true
}

describe("repository", () => {
  it("is licensed under AGPL-3.0", async () => {
    const license = await Bun.file(new URL("LICENSE", root)).text()
    expect(license).toContain("GNU AFFERO GENERAL PUBLIC LICENSE")
    expect(license).toContain("Version 3, 19 November 2007")
  })

  it("documents Twitch app registration and self-hosting in the README", async () => {
    const readme = await Bun.file(new URL("README.md", root)).text()
    expect(readme).toMatch(/^## Twitch app registration$/m)
    expect(readme).toMatch(/^## Self-hosting$/m)
  })

  // A part without its test file would drop its scenarios from that target without a failing test.
  it("runs every contract part against both targets, one test file each", async () => {
    const expected = contractParts.map((_, index) => `contract-${index + 1}.test.ts`)
    for (const app of ["apps/server/test", "apps/cloudflare/test"]) {
      const dir = new URL(`${app}/`, root)
      const files = [...new Bun.Glob("contract-*.test.ts").scanSync(fileURLToPath(dir))]
      expect(files.toSorted()).toEqual(expected)
      for (const [index, name] of expected.entries()) {
        // The part number is the last argument of the define call that ends the file.
        const source = await Bun.file(new URL(name, dir)).text()
        expect(source.match(/(\d+)\)\s*$/)?.[1]).toBe(String(index + 1))
      }
    }
  })

  // A relative asset URL resolves against /g/<code> and the SPA fallback answers it with HTML: a blank page.
  it("builds the web app with root-relative asset URLs so nested routes load", async () => {
    buildWeb()
    const html = await Bun.file(new URL("index.html", dist)).text()
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1])
    expect(assets.length).toBeGreaterThan(0)
    for (const asset of assets) expect(asset).toStartWith("/")
  }, 60_000)

  it("builds the favicons, the manifest and the headers file under stable names", async () => {
    buildWeb()
    const manifest: { icons: { src: string }[] } = await Bun.file(
      new URL("site.webmanifest", dist),
    ).json()

    expect(manifest.icons.length).toBeGreaterThan(0)
    for (const { src } of manifest.icons) expect(existsSync(new URL(src.slice(1), dist))).toBe(true)
    for (const name of [
      "favicon.svg",
      "favicon-32.png",
      "favicon.ico",
      "og.png",
      "apple-touch-icon.png",
      "icon-192.png",
      "icon-512.png",
      "icon-maskable-512.png",
      "_headers",
    ]) {
      expect(existsSync(new URL(name, dist))).toBe(true)
    }
  }, 60_000)

  // font-src is 'self', so the fonts ship with the build; their versioned names make a year of caching safe.
  it("builds the vendored fonts and marks /fonts/* immutable in the headers file", async () => {
    buildWeb()
    const headers = await Bun.file(new URL("_headers", dist)).text()

    for (const name of ["geist-1.9.2.woff2", "geist-mono-1.9.2.woff2"]) {
      expect(existsSync(new URL(`fonts/${name}`, dist))).toBe(true)
    }
    expect(existsSync(new URL("licenses/geist-OFL.txt", dist))).toBe(true)
    expect(headers).toContain(
      "\n/fonts/*\n  ! Cache-Control\n  Cache-Control: public, max-age=31536000, immutable\n",
    )
  }, 60_000)

  // The CSP allows the inline theme script by hash, so a script edit without a new hash is a blank page.
  it("allows the one inline script of the built page by its hash in the headers file", async () => {
    buildWeb()
    const html = await Bun.file(new URL("index.html", dist)).text()
    const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    const headers = await Bun.file(new URL("_headers", dist)).text()

    expect(inline).toHaveLength(1)
    const hash = createHash("sha256")
      .update(inline[0]?.[1] ?? "")
      .digest("base64")
    expect(headers).toContain(`script-src 'self' 'sha256-${hash}';`)
  }, 60_000)

  it("builds a robots.txt that keeps crawlers off the API and the streamer pages and names no sitemap", async () => {
    buildWeb()
    const robots = await Bun.file(new URL("robots.txt", dist)).text()

    expect(robots).toContain("Allow: /\n")
    for (const path of ["/api/", "/auth/", "/dashboard", "/live/", "/overlay/", "/admin"]) {
      expect(robots).toContain(`Disallow: ${path}\n`)
    }
    expect(robots).not.toContain("Sitemap")
  }, 60_000)

  it("writes headers for every static path: noindex everywhere but the home and legal pages, HSTS and no-cache", async () => {
    buildWeb()
    const headers = await Bun.file(new URL("_headers", dist)).text()

    expect(headers).toStartWith("/*\n")
    expect(headers).toContain("\n/:segment\n  X-Robots-Tag: noindex, nofollow\n")
    expect(headers).toContain("\n/privacy\n  ! X-Robots-Tag\n")
    expect(headers).toContain("\n/terms\n  ! X-Robots-Tag\n")
    expect(headers).not.toContain("\n/\n  ! X-Robots-Tag")
    expect(headers).toContain("  Strict-Transport-Security: max-age=31536000; includeSubDomains\n")
    expect(headers).toContain("  Cache-Control: no-cache\n")
  }, 60_000)

  // The rewriter finds its tags by name, so a tag the build drops or reorders would silently keep the home text.
  it("keeps every tag the page rewriter writes in the built page", async () => {
    buildWeb()
    const html = await Bun.file(new URL("index.html", dist)).text()

    const rendered = renderSpaHtml(html, {
      url: "https://example.test/ABCDE",
      image: "https://example.test/og.png",
      text: { title: 'T<&>"1', description: 'D<&>"2' },
    })

    expect(rendered.match(/T&lt;&amp;&gt;&quot;1/g)).toHaveLength(3)
    expect(rendered.match(/D&lt;&amp;&gt;&quot;2/g)).toHaveLength(3)
    expect(rendered.match(/https:\/\/example\.test\/ABCDE/g)).toHaveLength(2)
    expect(rendered.match(/https:\/\/example\.test\/og\.png/g)).toHaveLength(2)
  }, 60_000)
})
