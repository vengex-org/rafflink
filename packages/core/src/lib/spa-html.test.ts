import { describe, expect, it } from "bun:test"
import { inlineScript, spaTemplate } from "../../test/contract/spa-fixture.ts"
import {
  errorReportOrigin,
  inlineScriptHashes,
  renderSpaHtml,
  withErrorReportingMeta,
} from "./spa-html.ts"

const meta = { url: "https://example.test/ABCDE", image: "https://example.test/og.png" }

describe("renderSpaHtml", () => {
  it("writes the title and description into every tag that carries them", () => {
    const html = renderSpaHtml(spaTemplate, {
      ...meta,
      text: { title: "Cup", description: "Win it" },
    })

    expect(html).toContain("<title>Cup</title>")
    expect(html).toContain(`<meta name="description" content="Win it" />`)
    expect(html).toContain(`<meta property="og:title" content="Cup" />`)
    expect(html).toContain(`<meta property="og:description" content="Win it" />`)
    expect(html).toContain(`<meta name="twitter:title" content="Cup" />`)
    expect(html).toContain(`<meta name="twitter:description" content="Win it" />`)
  })

  it("escapes untrusted text so it cannot close a tag or open a script", () => {
    const html = renderSpaHtml(spaTemplate, {
      ...meta,
      text: { title: `</title><script>alert(1)</script>`, description: `" onload="x' & <b>` },
    })

    expect(html).toContain("<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>")
    expect(html).toContain(`content="&quot; onload=&quot;x&#39; &amp; &lt;b&gt;"`)
    expect(html).not.toContain("<script>alert")
  })

  it("keeps replacement patterns in the text literal", () => {
    const html = renderSpaHtml(spaTemplate, {
      ...meta,
      text: { title: "$& $1 $$", description: "$`" },
    })

    expect(html).toContain("<title>$&amp; $1 $$</title>")
    expect(html).toContain('content="$`"')
  })

  it("keeps the template's own text when the page has none and still sets the address and image", () => {
    const html = renderSpaHtml(spaTemplate, { ...meta, text: null })

    expect(html).toContain("<title>Rafflink home</title>")
    expect(html).toContain(`<link rel="canonical" href="https://example.test/ABCDE" />`)
    expect(html).toContain(`<meta property="og:url" content="https://example.test/ABCDE" />`)
    expect(html).toContain(`<meta property="og:image" content="https://example.test/og.png" />`)
    expect(html).toContain(`<meta name="twitter:image" content="https://example.test/og.png" />`)
  })
})

describe("inlineScriptHashes", () => {
  it("hashes the inline script and skips the one with a src", async () => {
    const expected = new Bun.CryptoHasher("sha256").update(inlineScript).digest("base64")

    expect(await inlineScriptHashes(spaTemplate)).toEqual([`sha256-${expected}`])
  })

  it("finds no hash in a page without inline scripts", async () => {
    expect(await inlineScriptHashes(`<script src="/a.js"></script>`)).toEqual([])
  })
})

describe("withErrorReportingMeta", () => {
  const reporting = {
    sentryDsn: "https://public@o1.ingest.de.sentry.io/2",
    sentryEnvironment: "production",
    sentryRelease: "abc123",
    sentrySamplePercent: 50,
  }

  it("writes the settings into the head, and the CSP origin is the DSN's ingest", async () => {
    const html = withErrorReportingMeta(spaTemplate, reporting)

    expect(html).toContain(`<meta name="sentry-dsn" content="${reporting.sentryDsn}" />`)
    expect(html).toContain(`<meta name="sentry-environment" content="production" />`)
    expect(html).toContain(`<meta name="sentry-release" content="abc123" />`)
    expect(html).toContain(`<meta name="sentry-sample-percent" content="50" />`)
    expect(errorReportOrigin(html)).toBe("https://o1.ingest.de.sentry.io")
    expect(await inlineScriptHashes(html)).toEqual(await inlineScriptHashes(spaTemplate))
  })

  it("leaves the page as it is without a DSN, so the CSP allows no ingest", () => {
    const html = withErrorReportingMeta(spaTemplate, { ...reporting, sentryDsn: null })

    expect(html).toBe(spaTemplate)
    expect(errorReportOrigin(html)).toBeNull()
  })

  it("leaves out the release when none is set", () => {
    const html = withErrorReportingMeta(spaTemplate, { ...reporting, sentryRelease: null })

    expect(html).not.toContain("sentry-release")
  })
})
