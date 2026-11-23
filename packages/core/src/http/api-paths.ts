/** Paths the HTTP app of core answers. */
export const apiPrefixes = ["/api/", "/auth/"] as const

/** Paths of the fake Twitch; without it they answer like any other unknown API path. */
export const fakeTwitchPrefixes = ["/oauth2/", "/helix/", "/eventsub/"] as const

/** Paths of the fake Kick; without it they answer like any other unknown API path. */
export const fakeKickPrefixes = ["/oauth/", "/public/v1/"] as const

/** A path no page lives at: an unknown one is a JSON 404, never the SPA. */
export function isApiPath(pathname: string): boolean {
  return [...apiPrefixes, ...fakeTwitchPrefixes, ...fakeKickPrefixes].some((prefix) =>
    pathname.startsWith(prefix),
  )
}
