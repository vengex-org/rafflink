/** The kind of page a person on the site has open; the admin page counts the open pages per kind. */
export const presenceKinds = ["home", "legal", "dashboard", "giveaway", "other"] as const

export type PresenceKind = (typeof presenceKinds)[number]

/** The WebSocket each page of the site except the stream's pages holds open, with its page kind in `?kind=`. */
export const presenceSocketPath = "/api/presence"

/** Set by the presence route on its answer to an upgrade request: the page kind the target's socket layer tags the socket with. */
export const presenceKindHeader = "x-rafflink-presence-kind"

/** How many pages are open on the site now, in total and per kind. Counts only: nothing names a person. */
export interface PresenceCounts {
  readonly total: number
  readonly byKind: Readonly<Record<PresenceKind, number>>
}

/** Counts the pages that hold a presence socket open now. */
export interface SitePresence {
  counts(): Promise<PresenceCounts>
}

/** The presence route's `kind` parameter; null for a value that names no kind. */
export function parsePresenceKind(value: string | null | undefined): PresenceKind | null {
  return presenceKinds.find((kind) => kind === value) ?? null
}

/** The counts of the open pages, `openOf` giving the number of each kind. */
export function presenceCountsOf(openOf: (kind: PresenceKind) => number): PresenceCounts {
  const byKind: Record<PresenceKind, number> = {
    home: openOf("home"),
    legal: openOf("legal"),
    dashboard: openOf("dashboard"),
    giveaway: openOf("giveaway"),
    other: openOf("other"),
  }
  return { total: Object.values(byKind).reduce((sum, open) => sum + open, 0), byKind }
}
