import { useEffect, useEffectEvent, useRef, type RefObject } from "react"

/** Pointer samples older than this say nothing about the speed at release. */
const velocityWindowMs = 100
/** Share of the flick speed kept per millisecond, close to the deceleration of a phone's scroll view. */
const friction = 0.997
/** Below this speed, in px per ms, the flick has stopped. */
const restingSpeed = 0.02

const reducedMotion = "(prefers-reduced-motion: reduce)"

interface Sample {
  readonly y: number
  readonly at: number
}

/**
 * Scrolls the element by dragging it with a mouse or a pen, the way a finger scrolls a phone: the content follows
 * the pointer and, after a flick, glides on and slows down (not under reduced motion). Touch keeps the browser's
 * own scrolling, the wheel scrolls it natively. `onActivity` runs on every press, move, wheel turn and glide frame.
 */
export function useDragScroll<T extends HTMLElement>(onActivity: () => void): RefObject<T | null> {
  const ref = useRef<T>(null)
  const report = useEffectEvent(onActivity)
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    let drag: {
      readonly pointerId: number
      readonly startY: number
      readonly startTop: number
    } | null = null
    let samples: Sample[] = []
    let frame = 0

    const scrollTo = (top: number): boolean => {
      const max = Math.max(0, element.scrollHeight - element.clientHeight)
      const clamped = Math.min(max, Math.max(0, top))
      element.scrollTop = clamped
      return clamped === top
    }
    const stopGlide = () => {
      cancelAnimationFrame(frame)
      frame = 0
    }
    const glide = (speed: number) => {
      let top = element.scrollTop
      let velocity = speed
      let last: number | null = null
      const step = (now: number) => {
        const elapsed = last === null ? 0 : now - last
        last = now
        top -= velocity * elapsed
        velocity *= friction ** elapsed
        report()
        if (!scrollTo(top) || Math.abs(velocity) < restingSpeed) {
          frame = 0
          return
        }
        frame = requestAnimationFrame(step)
      }
      frame = requestAnimationFrame(step)
    }

    const onPointerDown = (event: PointerEvent) => {
      report()
      stopGlide()
      if (event.pointerType === "touch" || event.button !== 0) return
      event.preventDefault()
      element.setPointerCapture(event.pointerId)
      element.dataset.dragging = ""
      drag = { pointerId: event.pointerId, startY: event.clientY, startTop: element.scrollTop }
      samples = [{ y: event.clientY, at: event.timeStamp }]
    }
    const onPointerMove = (event: PointerEvent) => {
      if (drag?.pointerId !== event.pointerId) return
      report()
      scrollTo(drag.startTop - (event.clientY - drag.startY))
      samples = [
        ...samples.filter((sample) => event.timeStamp - sample.at <= velocityWindowMs),
        { y: event.clientY, at: event.timeStamp },
      ]
    }
    const endDrag = (event: PointerEvent, flick: boolean) => {
      if (drag?.pointerId !== event.pointerId) return
      drag = null
      delete element.dataset.dragging
      report()
      const speed = releaseSpeed(samples, event.timeStamp)
      if (flick && speed !== 0 && !window.matchMedia(reducedMotion).matches) glide(speed)
    }
    const onPointerUp = (event: PointerEvent) => endDrag(event, true)
    const onPointerCancel = (event: PointerEvent) => endDrag(event, false)
    const onWheel = () => {
      stopGlide()
      report()
    }

    element.addEventListener("pointerdown", onPointerDown)
    element.addEventListener("pointermove", onPointerMove)
    element.addEventListener("pointerup", onPointerUp)
    element.addEventListener("pointercancel", onPointerCancel)
    element.addEventListener("wheel", onWheel, { passive: true })
    return () => {
      stopGlide()
      element.removeEventListener("pointerdown", onPointerDown)
      element.removeEventListener("pointermove", onPointerMove)
      element.removeEventListener("pointerup", onPointerUp)
      element.removeEventListener("pointercancel", onPointerCancel)
      element.removeEventListener("wheel", onWheel)
    }
  }, [])
  return ref
}

/** The pointer's speed in px per ms over the last moments of the drag; a pointer that came to rest gives 0. */
function releaseSpeed(samples: readonly Sample[], releasedAt: number): number {
  const recent = samples.filter((sample) => releasedAt - sample.at <= velocityWindowMs)
  const first = recent[0]
  const last = recent.at(-1)
  if (first === undefined || last === undefined || last.at === first.at) return 0
  return (last.y - first.y) / (last.at - first.at)
}
