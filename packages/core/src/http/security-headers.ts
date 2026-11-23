import type { MiddlewareHandler } from "hono"
import type { ResolvedConfig } from "../config.ts"
import { publicDrandUrls } from "../lib/drand.ts"
import { twitchImageHost } from "../twitch/lib/image-url.ts"

export interface SecurityHeaderOptions {
  /** Only a deployment served over https sends HSTS; browsers ignore it over http, but a local http origin must not pin itself. */
  readonly hsts: boolean
  /** CSP hash sources (`sha256-...`) of the inline scripts of the page the response carries; empty for JSON. */
  readonly scriptHashes: readonly string[]
  /** Origin of the Sentry ingest the page reports its errors to (`errorReportOrigin` of its HTML); null for JSON and a page without one. */
  readonly errorReportOrigin: string | null
}

// A page of this app embeds nothing and is embedded nowhere. `connect-src 'self'` covers the live
// WebSocket in current browsers; the drand origins are where the verify page reads the draw's round.
// Profile pictures and badges of Twitch accounts are images from Twitch's CDN.
// React sets style props through the CSSOM, which `style-src` does not block. The error reporter posts to the
// Sentry ingest of the web build's DSN.
export function contentSecurityPolicy(
  scriptHashes: readonly string[],
  errorReportOrigin: string | null,
): string {
  const scripts = ["'self'", ...scriptHashes.map((hash) => `'${hash}'`)].join(" ")
  const connect = [
    "'self'",
    ...publicDrandUrls,
    ...(errorReportOrigin === null ? [] : [errorReportOrigin]),
  ]
  return [
    "default-src 'self'",
    `script-src ${scripts}`,
    "style-src 'self'",
    `img-src 'self' data: https://${twitchImageHost}`,
    `connect-src ${connect.join(" ")}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ")
}

export function securityHeaders(options: SecurityHeaderOptions): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(
      options.scriptHashes,
      options.errorReportOrigin,
    ),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    ...(options.hsts ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
  }
}

export function isHttps(publicUrl: string): boolean {
  return new URL(publicUrl).protocol === "https:"
}

/** Adds the security headers to every response; a header the handler already set (the CSP of a page) stays. */
export function securityHeadersMiddleware(
  config: Pick<ResolvedConfig, "publicUrl">,
): MiddlewareHandler {
  const headers = securityHeaders({
    hsts: isHttps(config.publicUrl),
    scriptHashes: [],
    errorReportOrigin: null,
  })
  return async (c, next) => {
    await next()
    for (const [name, value] of Object.entries(headers)) {
      if (!c.res.headers.has(name)) c.header(name, value)
    }
  }
}
