/** What one dashboard screen tells the next through the history entry, which survives a reload of the page. */
export type DashboardNotice =
  | { readonly kind: "not-approved" }
  | { readonly kind: "created"; readonly roomReady: boolean; readonly usageLow: number | null }

/** Narrows the history state once; anything else is no notice. */
export function readNotice(state: unknown): DashboardNotice | null {
  if (typeof state !== "object" || state === null || !("kind" in state)) return null
  if (state.kind === "not-approved") return { kind: "not-approved" }
  if (
    state.kind === "created"
    && "roomReady" in state
    && typeof state.roomReady === "boolean"
    && "usageLow" in state
    && (state.usageLow === null || typeof state.usageLow === "number")
  ) {
    return { kind: "created", roomReady: state.roomReady, usageLow: state.usageLow }
  }
  return null
}
