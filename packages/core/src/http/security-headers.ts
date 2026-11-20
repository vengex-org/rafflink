import type { MiddlewareHandler } from "hono"
import type { ResolvedConfig } from "../config.ts"

export interface SecurityHeaderOptions {
  /** Only a deployment served over https sends HSTS; browsers ignore it over http, but a local http origin must not pin itself. */
  readonly hsts: boolean
  /** CSP hash sources (`sha256-...`) of the inline scripts of the page the response carries; empty for JSON. */
  readonly scriptHashes: readonly string[]
}

// A page of this app embeds nothing and is embedded nowhere. `connect-src 'self'` covers the live
// WebSocket in current browsers. React sets style props through the CSSOM, which `style-src` does not block.
export function contentSecurityPolicy(scriptHashes: readonly string[]): string {
  const scripts = ["'self'", ...scriptHashes.map((hash) => `'${hash}'`)].join(" ")
  return [
    "default-src 'self'",
    `script-src ${scripts}`,
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ")
}

export function securityHeaders(options: SecurityHeaderOptions): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(options.scriptHashes),
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
  const headers = securityHeaders({ hsts: isHttps(config.publicUrl), scriptHashes: [] })
  return async (c, next) => {
    await next()
    for (const [name, value] of Object.entries(headers)) {
      if (!c.res.headers.has(name)) c.header(name, value)
    }
  }
}
