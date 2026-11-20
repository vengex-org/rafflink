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

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}
