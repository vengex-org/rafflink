/** The client address the reverse proxy in front of the server appended to `X-Forwarded-For`; null when there is none, as in local development. */
export function forwardedAddress(request: Request): string | null {
  const hops = request.headers.get("x-forwarded-for")?.split(",") ?? []
  const nearest = hops.at(-1)?.trim() ?? ""
  return nearest === "" ? null : nearest
}
