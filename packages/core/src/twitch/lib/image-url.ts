/** The host Twitch serves profile pictures and chat badges from; the CSP `img-src` of every page names it too. */
export const twitchImageHost = "static-cdn.jtvnw.net"

/** Twitch's picture and badge URLs are about 100 characters; a longer value is not one of them and is not stored per entry. */
const maxImageUrlLength = 512

/** The URL when it is an https URL on {@link twitchImageHost} with no credentials or port, `null` for anything else, so a value Twitch did not send cannot point a page at another host. */
export function twitchImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > maxImageUrlLength) return null
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
  return allowed && url.href.length <= maxImageUrlLength ? url.href : null
}
