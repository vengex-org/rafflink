const localHostnames: readonly string[] = ["localhost", "127.0.0.1", "[::1]"]

/** Thrown for a URL that is not on this machine; the load test must never send a request to it. */
export class NonLocalUrlError extends Error {
  constructor(readonly host: string) {
    super(`refusing ${host}: the load test only talks to localhost, 127.0.0.1 or [::1]`)
  }
}

/** Parses `text` and returns it when its host is this machine; throws {@link NonLocalUrlError} otherwise. */
export function assertLocalUrl(text: string): URL {
  const url = new URL(text)
  const isWebUrl = url.protocol === "http:" || url.protocol === "https:"
  if (!isWebUrl || !localHostnames.includes(url.hostname)) throw new NonLocalUrlError(url.host)
  return url
}
