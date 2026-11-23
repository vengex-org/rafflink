import {
  presenceCountsOf,
  type PresenceCounts,
  type PresenceKind,
  type SitePresence,
} from "../presence/site-presence.ts"

/** A {@link SitePresence} in the memory of one process: the open sockets per kind, nothing about who holds them. */
export class MemorySitePresence implements SitePresence {
  private readonly open = new Map<PresenceKind, number>()

  /** Counts a socket of `kind` that just opened; the returned function counts it closed. */
  join(kind: PresenceKind): () => void {
    this.open.set(kind, this.openOf(kind) + 1)
    return () => this.open.set(kind, this.openOf(kind) - 1)
  }

  async counts(): Promise<PresenceCounts> {
    return presenceCountsOf((kind) => this.openOf(kind))
  }

  private openOf(kind: PresenceKind): number {
    return this.open.get(kind) ?? 0
  }
}
