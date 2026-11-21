/** The address of the client of `request`, or null when it is unknown. */
export function clientAddress(
  request: Request,
  server: { requestIP(request: Request): { readonly address: string } | null },
  header: string | null,
): string | null {
  if (header === null) return server.requestIP(request)?.address ?? null
  const hops = request.headers.get(header)?.split(",") ?? []
  const nearest = hops.at(-1)?.trim() ?? ""
  return nearest === "" ? null : nearest
}
