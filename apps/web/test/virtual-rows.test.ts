import { describe, expect, it } from "bun:test"
import { visibleRows } from "../src/lib/use-virtual-rows.ts"

describe("visibleRows", () => {
  const geometry = { rowHeight: 10, viewportHeight: 50, overscan: 2 }

  it("covers the viewport plus the overscan on both sides", () => {
    expect(visibleRows(100, 1000, geometry)).toEqual({ first: 8, end: 17 })
  })

  it("starts at the first row and clamps the overscan at the top", () => {
    expect(visibleRows(0, 1000, geometry)).toEqual({ first: 0, end: 7 })
  })

  it("stops at the last row, also when the scroll position is past the end", () => {
    expect(visibleRows(1_000_000, 1000, geometry)).toEqual({ first: 993, end: 1000 })
  })

  it("renders every row of a list shorter than the viewport and none of an empty list", () => {
    expect(visibleRows(0, 3, geometry)).toEqual({ first: 0, end: 3 })
    expect(visibleRows(40, 0, geometry)).toEqual({ first: 0, end: 0 })
  })

  it("treats a negative scroll position as the top", () => {
    expect(visibleRows(-30, 1000, geometry)).toEqual({ first: 0, end: 7 })
  })
})
