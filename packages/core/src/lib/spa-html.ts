import type { ErrorReportingConfig } from "../config.ts"
import { toBase64 } from "./encoding.ts"

/** What a page tells browsers and link previews about itself. */
export interface PageMeta {
  /** Absolute address of the page. */
  readonly url: string
  /** Absolute address of the preview image. */
  readonly image: string
  /** Replaces the title and the description of the template; null keeps the template's own. */
  readonly text: { readonly title: string; readonly description: string } | null
}

/**
 * Writes `meta` into the head of the built `index.html`. Every tag it rewrites must exist in the
 * template, with the attribute that names it (`name`, `property` or `rel`) before the value.
 * The text is untrusted (a streamer wrote it), so it is escaped for an attribute and for element text.
 */
export function renderSpaHtml(template: string, meta: PageMeta): string {
  let html = template
  html = replaceTag(html, "link", "rel", "canonical", "href", meta.url)
  html = replaceTag(html, "meta", "property", "og:url", "content", meta.url)
  html = replaceTag(html, "meta", "property", "og:image", "content", meta.image)
  html = replaceTag(html, "meta", "name", "twitter:image", "content", meta.image)
  if (meta.text === null) return html
  const { title, description } = meta.text
  html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`)
  html = replaceTag(html, "meta", "name", "description", "content", description)
  html = replaceTag(html, "meta", "property", "og:title", "content", title)
  html = replaceTag(html, "meta", "property", "og:description", "content", description)
  html = replaceTag(html, "meta", "name", "twitter:title", "content", title)
  return replaceTag(html, "meta", "name", "twitter:description", "content", description)
}

/**
 * Adds `json` to the end of the head as a JSON element with this id and `data-path`, which a CSP does not block:
 * the browser never runs it. `<` is written as a JSON escape, so no text inside can close the element.
 */
export function embedJson(html: string, id: string, path: string, json: string): string {
  const element = `<script type="application/json" id="${escapeHtml(id)}" data-path="${escapeHtml(path)}">${json.replaceAll("<", "\\u003c")}</script>`
  return html.replace("</head>", () => `${element}</head>`)
}

/** The `<meta>` names that carry the browser's error reporting settings from the web build to the page. */
export const errorReportingMetaNames = {
  dsn: "sentry-dsn",
  environment: "sentry-environment",
  release: "sentry-release",
  samplePercent: "sentry-sample-percent",
} as const

/** Writes the error reporting settings into the head of the built `index.html`; without a DSN it stays as it is. */
export function withErrorReportingMeta(html: string, config: ErrorReportingConfig): string {
  if (config.sentryDsn === null) return html
  const names = errorReportingMetaNames
  const tags = [
    metaTag(names.dsn, config.sentryDsn),
    metaTag(names.environment, config.sentryEnvironment),
    ...(config.sentryRelease === null ? [] : [metaTag(names.release, config.sentryRelease)]),
    metaTag(names.samplePercent, String(config.sentrySamplePercent)),
  ]
  return html.replace("</head>", () => `${tags.join("")}</head>`)
}

/** The origin of the Sentry ingest the page's error reporter posts to, which its CSP must allow; null when it has none. */
export function errorReportOrigin(html: string): string | null {
  const found = new RegExp(`<meta name="${errorReportingMetaNames.dsn}" content="([^"]+)"`).exec(
    html,
  )
  const dsn = found?.[1]
  return dsn === undefined || !URL.canParse(dsn) ? null : new URL(dsn).origin
}

/** The CSP hash sources (`sha256-...`) of the inline scripts of `html`, which a CSP without `unsafe-inline` allows by hash. */
export async function inlineScriptHashes(html: string): Promise<string[]> {
  const hashes: string[] = []
  for (const [, attributes = "", body = ""] of html.matchAll(
    /<script([^>]*)>([\s\S]*?)<\/script>/g,
  )) {
    if (/\ssrc=/.test(attributes)) continue
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))
    hashes.push(`sha256-${toBase64(new Uint8Array(digest))}`)
  }
  return hashes
}

function replaceTag(
  html: string,
  tag: "meta" | "link",
  key: "name" | "property" | "rel",
  keyValue: string,
  valueAttribute: "content" | "href",
  value: string,
): string {
  const found = new RegExp(`<${tag}\\s+${key}="${keyValue}"[^>]*>`)
  return html.replace(
    found,
    () => `<${tag} ${key}="${keyValue}" ${valueAttribute}="${escapeHtml(value)}" />`,
  )
}

function metaTag(name: string, content: string): string {
  return `<meta name="${name}" content="${escapeHtml(content)}" />`
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}
