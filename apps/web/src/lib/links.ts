export function shareUrl(code: string): string {
  return new URL(`/${code}`, window.location.origin).href
}

export function overlayUrl(id: string, overlayToken: string): string {
  return new URL(
    `/overlay/${encodeURIComponent(id)}/${encodeURIComponent(overlayToken)}`,
    window.location.origin,
  ).href
}
