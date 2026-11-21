/** The host Twitch serves profile pictures and chat badges from; the CSP `img-src` of every page names it too. */
export const twitchImageHost = "static-cdn.jtvnw.net"

/** The URL when it is an https URL on {@link twitchImageHost} with no credentials or port, `null` for anything else, so a value Twitch did not send cannot point a page at another host. */
export function twitchImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const allowed =
    url.protocol === "https:"
    && url.hostname === twitchImageHost
    && url.port === ""
    && url.username === ""
    && url.password === ""
  return allowed ? url.href : null
}
