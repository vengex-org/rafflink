export function shareUrl(code: string): string {
  return new URL(`/${code}`, window.location.origin).href
}

export function overlayUrl(id: string, overlayToken: string): string {
  return new URL(
    `/overlay/${encodeURIComponent(id)}/${encodeURIComponent(overlayToken)}`,
    window.location.origin,
  ).href
}

/** The README section that lists the Twitch app settings, including the redirect URLs. */
export const setupGuideUrl = "https://github.com/vengex-org/rafflink#twitch-app-registration"
