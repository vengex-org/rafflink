import { useState, type UIEvent } from "react"

/** The fixed pixel sizes a scrolling list of equal rows is laid out with. */
export interface RowGeometry {
  readonly rowHeight: number
  readonly viewportHeight: number
  /** Rows rendered beyond the viewport on each side, so a fast scroll does not show blanks. */
  readonly overscan: number
}

/** The rows `[first, end)` to render for a list of `count` rows scrolled by `scrollTop` pixels. */
export function visibleRows(
  scrollTop: number,
  count: number,
  geometry: RowGeometry,
): { readonly first: number; readonly end: number } {
  const { rowHeight, viewportHeight, overscan } = geometry
  const top = Math.max(0, Math.min(scrollTop, count * rowHeight - viewportHeight))
  return {
    first: Math.max(0, Math.floor(top / rowHeight) - overscan),
    end: Math.min(count, Math.ceil((top + viewportHeight) / rowHeight) + overscan),
  }
}

/** Windowing for a scrolling box of `count` equal rows: render only `[first, end)` between two spacers. `reset` is for after the box was scrolled back to the top. */
export function useVirtualRows(count: number, geometry: RowGeometry) {
  const [scrollTop, setScrollTop] = useState(0)
  return {
    ...visibleRows(scrollTop, count, geometry),
    onScroll: (event: UIEvent<HTMLDivElement>) => setScrollTop(event.currentTarget.scrollTop),
    reset: () => setScrollTop(0),
  }
}
