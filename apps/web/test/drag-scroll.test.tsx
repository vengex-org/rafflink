import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { useDragScroll } from "../src/lib/use-drag-scroll.ts"

const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 1

beforeEach(() => {
  frames.clear()
  dragging.current = false
  spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(nextFrame, callback)
    return nextFrame++
  })
  spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id)
  })
})
afterEach(() => {
  cleanup()
  mock.restore()
})

/** Runs the pending frames at `now`, as the browser does once per paint. */
const paint = (now: number) => {
  const pending = [...frames.values()]
  frames.clear()
  for (const callback of pending) callback(now)
}
/** Paints every 16 ms from `from` until no frame is asked for; returns how many frames ran. */
const paintUntilIdle = (from: number) => {
  let painted = 0
  for (let now = from; frames.size > 0 && painted < 1000; now += 16) {
    paint(now)
    painted++
  }
  return painted
}

const reduceMotion = (reduce: boolean) =>
  spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))

const dragging = { current: false }

function Scroller({ onActivity }: { readonly onActivity: () => void }) {
  const ref = useDragScroll<HTMLDivElement>(onActivity, dragging)
  return <div ref={ref} data-testid="scroller" />
}

/** A 300px tall screen over 1000px of content, so it scrolls from 0 to 700. */
const mountScroller = (onActivity = () => {}) => {
  const view = render(<Scroller onActivity={onActivity} />)
  const element = view.getByTestId("scroller")
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: 1000 })
  Object.defineProperty(element, "clientHeight", { configurable: true, value: 300 })
  element.setPointerCapture = () => {}
  return { element, view }
}

const pointer = (
  element: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel" | "lostpointercapture",
  clientY: number,
  at: number,
  pointerType = "mouse",
  buttons = type === "pointerup" ? 0 : 1,
) => {
  const event = new PointerEvent(type, {
    clientY,
    pointerId: 1,
    pointerType,
    button: 0,
    buttons,
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperty(event, "timeStamp", { value: at })
  element.dispatchEvent(event)
  return event
}

/** Drags from y=500 up by 100px in 10px moves 10 ms apart, so it leaves at 1 px per ms upwards. */
const flickUp = (element: HTMLElement) => {
  pointer(element, "pointerdown", 500, 0)
  for (let step = 1; step <= 10; step++) pointer(element, "pointermove", 500 - step * 10, step * 10)
}

describe("useDragScroll", () => {
  beforeEach(() => reduceMotion(false))

  it("scrolls the content with the dragging pointer, like a finger, and marks the drag", () => {
    const { element } = mountScroller()
    element.scrollTop = 100

    const down = pointer(element, "pointerdown", 400, 0)
    expect(down.defaultPrevented).toBe(true)
    expect(element.hasAttribute("data-dragging")).toBe(true)

    pointer(element, "pointermove", 250, 500)
    expect(element.scrollTop).toBe(250)

    pointer(element, "pointermove", 450, 1000)
    expect(element.scrollTop).toBe(50)

    pointer(element, "pointerup", 450, 1500)
    expect(element.hasAttribute("data-dragging")).toBe(false)
    expect(frames.size).toBe(0)
  })

  it("stops at the top and at the bottom edge", () => {
    const { element } = mountScroller()

    pointer(element, "pointerdown", 400, 0)
    pointer(element, "pointermove", 600, 500)
    expect(element.scrollTop).toBe(0)

    pointer(element, "pointermove", -900, 1000)
    expect(element.scrollTop).toBe(700)
  })

  it("keeps gliding after a flick, slower each frame, then stops", () => {
    const { element } = mountScroller()
    flickUp(element)
    expect(element.scrollTop).toBe(100)

    pointer(element, "pointerup", 400, 100)
    paint(100)
    paint(116)
    const firstStep = element.scrollTop - 100
    paint(132)
    const secondStep = element.scrollTop - 100 - firstStep

    expect(firstStep).toBeGreaterThan(10)
    expect(secondStep).toBeLessThan(firstStep)
    expect(paintUntilIdle(148)).toBeLessThan(1000)
    expect(element.scrollTop).toBeGreaterThan(300)
    expect(element.scrollTop).toBeLessThan(700)
  })

  it("ends a glide at the edge it runs into", () => {
    const { element } = mountScroller()
    element.scrollTop = 600
    pointer(element, "pointerdown", 500, 0)
    for (let step = 1; step <= 5; step++)
      pointer(element, "pointermove", 500 - step * 10, step * 10)

    pointer(element, "pointerup", 450, 50)
    const painted = paintUntilIdle(50)

    expect(element.scrollTop).toBe(700)
    expect(painted).toBeLessThan(20)
  })

  it("does not glide when the pointer rested before the release", () => {
    const { element } = mountScroller()
    flickUp(element)

    pointer(element, "pointerup", 400, 400)

    expect(frames.size).toBe(0)
    expect(element.scrollTop).toBe(100)
  })

  it("does not glide under reduced motion, the drag still scrolls", () => {
    reduceMotion(true)
    const { element } = mountScroller()
    flickUp(element)

    pointer(element, "pointerup", 400, 100)

    expect(element.scrollTop).toBe(100)
    expect(frames.size).toBe(0)
  })

  it("stops a glide on the next press", () => {
    const { element } = mountScroller()
    flickUp(element)
    pointer(element, "pointerup", 400, 100)
    paint(100)
    paint(116)
    const caught = element.scrollTop

    pointer(element, "pointerdown", 400, 120)
    paintUntilIdle(132)

    expect(element.scrollTop).toBe(caught)
  })

  it("ignores a touch pointer", () => {
    const { element } = mountScroller()

    const down = pointer(element, "pointerdown", 400, 0, "touch")
    pointer(element, "pointermove", 200, 100, "touch")

    expect(down.defaultPrevented).toBe(false)
    expect(element.scrollTop).toBe(0)
  })

  it("reports each press, move and glide frame, and stops after unmount", () => {
    const onActivity = mock(() => {})
    const { element, view } = mountScroller(onActivity)

    pointer(element, "pointerdown", 400, 0)
    pointer(element, "pointermove", 380, 10)
    pointer(element, "pointerup", 360, 20)
    expect(onActivity).toHaveBeenCalledTimes(3)
    paint(20)
    expect(onActivity).toHaveBeenCalledTimes(4)

    view.unmount()
    expect(frames.size).toBe(0)
  })

  it("ends the drag when the pointer capture is lost", () => {
    const { element } = mountScroller()
    pointer(element, "pointerdown", 400, 0)
    expect(dragging.current).toBe(true)

    pointer(element, "lostpointercapture", 400, 10)
    expect(element.hasAttribute("data-dragging")).toBe(false)
    expect(dragging.current).toBe(false)

    pointer(element, "pointermove", 300, 20)
    expect(element.scrollTop).toBe(0)
  })

  it("ends the drag on a move with no button pressed", () => {
    const { element } = mountScroller()
    pointer(element, "pointerdown", 400, 0)

    pointer(element, "pointermove", 300, 10, "mouse", 0)

    expect(element.hasAttribute("data-dragging")).toBe(false)
    expect(dragging.current).toBe(false)
    expect(element.scrollTop).toBe(0)
  })

  it("reports a scroll the browser did itself, and stops after unmount", () => {
    const onActivity = mock(() => {})
    const { element, view } = mountScroller(onActivity)

    fireEvent.scroll(element)
    expect(onActivity).toHaveBeenCalledTimes(1)

    view.unmount()
    fireEvent.scroll(element)
    expect(onActivity).toHaveBeenCalledTimes(1)
  })
})
