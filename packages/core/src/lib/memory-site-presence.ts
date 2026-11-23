import {
  presenceCountsOf,
  type PresenceCounts,
  type SitePresence,
} from "../presence/site-presence.ts"

/**
 * A {@link SitePresence} in the memory of one process: the open sockets per tag, nothing about who holds them.
 * Like the tags of the Cloudflare presence object, only a tag that is a page kind is counted.
 */
export class MemorySitePresence implements SitePresence {
  private readonly open = new Map<string, number>()

  /** Counts a socket tagged with the kind the presence route named; the returned function counts it closed. */
  join(tag: string): () => void {
    this.open.set(tag, this.openOf(tag) + 1)
    return () => this.open.set(tag, this.openOf(tag) - 1)
  }

  async counts(): Promise<PresenceCounts> {
    return presenceCountsOf((kind) => this.openOf(kind))
  }

  private openOf(tag: string): number {
    return this.open.get(tag) ?? 0
  }
}
