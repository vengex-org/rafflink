import { useEffect, useRef, useState } from "react"
import type { EntrantsDelta } from "@rafflink/core/room/giveaway-room"
import type { Entrant } from "@rafflink/core/room/rows"
import { getEntrants } from "../api/client.ts"
import { errorClass } from "@rafflink/core/lib/error-class"

export interface EntrantsState {
  /** In the order they entered. */
  readonly rows: readonly Entrant[]
  readonly phase: "loading" | "ready" | "failed"
}

/** What the live socket tells the list: whether it is connected, and the newest push's new entrants. */
export interface EntrantsFeed {
  readonly connected: boolean
  readonly entrantsAfter: EntrantsDelta | null
}

interface Syncer {
  catchUp(): void
  apply(delta: EntrantsDelta): void
}

/**
 * The full entrant list of a giveaway: loaded page by page when the page opens, extended by the entrants
 * of each live push, and caught up over HTTP from the last sequence number whenever a push does not
 * continue the list (a gap, or more entrants than a push carries) and whenever the socket connects again.
 * The list belongs to one giveaway: mount it with `key={id}`.
 */
export function useEntrants(
  id: string,
  feed: EntrantsFeed,
): EntrantsState & { readonly retry: () => void } {
  const [state, setState] = useState<EntrantsState>({ rows: [], phase: "loading" })
  const syncer = useRef<Syncer | null>(null)

  useEffect(() => {
    let alive = true
    let lastSeq = 0
    let running = false
    let again = false
    let failed = false

    // Returns how many rows were new.
    const append = (rows: readonly Entrant[]): number => {
      const fresh = rows.filter((row) => row.seq > lastSeq)
      const last = fresh.at(-1)
      if (last === undefined) return 0
      lastSeq = last.seq
      setState((previous) => ({ ...previous, rows: [...previous.rows, ...fresh] }))
      return fresh.length
    }

    const catchUp = async (): Promise<void> => {
      if (running) {
        again = true
        return
      }
      running = true
      if (failed) {
        failed = false
        setState((previous) => ({ ...previous, phase: "loading" }))
      }
      try {
        do {
          again = false
          for (;;) {
            const page = await getEntrants(id, lastSeq)
            if (!alive) return
            if (append(page.rows) === 0 || !page.more) break
          }
        } while (again)
        setState((previous) => ({ ...previous, phase: "ready" }))
      } catch (error) {
        console.error("entrants load failed", { errorClass: errorClass(error) })
        failed = true
        if (alive) setState((previous) => ({ ...previous, phase: "failed" }))
      } finally {
        running = false
      }
    }

    const apply = (delta: EntrantsDelta): void => {
      if (running) {
        // The pass that runs reads from the server again, so it covers what this push carries.
        again = true
        return
      }
      if (delta.fromSeq > lastSeq) {
        void catchUp()
        return
      }
      append(delta.rows)
      if (delta.truncated) void catchUp()
    }

    syncer.current = { catchUp: () => void catchUp(), apply }
    void catchUp()
    return () => {
      alive = false
      syncer.current = null
    }
  }, [id])

  useEffect(() => {
    if (feed.connected) syncer.current?.catchUp()
  }, [feed.connected])

  useEffect(() => {
    if (feed.entrantsAfter !== null) syncer.current?.apply(feed.entrantsAfter)
  }, [feed.entrantsAfter])

  return { ...state, retry: () => syncer.current?.catchUp() }
}
