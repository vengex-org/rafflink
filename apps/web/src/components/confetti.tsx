import { useEffect, useRef, useState } from "react"

// One burst: enough pieces to read as confetti on a 1920x1080 canvas, short enough not to cover a winner for long.
const pieces = 140
const durationMs = 2600
const gravity = 0.0016

/** Whether the viewer asked for less motion; read once when a burst starts. */
function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** One burst of confetti over the whole browser source in the theme's accent and text colors; nothing under reduced motion. */
export function Confetti({ accent, text }: { readonly accent: string; readonly text: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [reduced] = useState(prefersReducedMotion)
  const [done, setDone] = useState(false)
  useEffect(() => {
    const context = canvas.current?.getContext("2d") ?? null
    if (reduced || context === null || canvas.current === null) return
    const { width, height } = canvas.current.getBoundingClientRect()
    canvas.current.width = width
    canvas.current.height = height
    const burst = Array.from({ length: pieces }, (_, index) => ({
      x: width * Math.random(),
      y: -height * 0.2 * Math.random(),
      vx: (Math.random() - 0.5) * 0.3,
      vy: Math.random() * 0.25,
      size: 8 + Math.random() * 10,
      spin: Math.random() * Math.PI,
      color: index % 2 === 0 ? accent : text,
    }))
    const start = performance.now()
    let frame = 0
    const draw = (now: number) => {
      const elapsed = now - start
      context.clearRect(0, 0, width, height)
      for (const piece of burst) {
        context.save()
        context.translate(
          piece.x + piece.vx * elapsed,
          piece.y + piece.vy * elapsed + 0.5 * gravity * elapsed ** 2,
        )
        context.rotate(piece.spin + elapsed / 200)
        context.fillStyle = piece.color
        context.globalAlpha = Math.max(0, 1 - elapsed / durationMs)
        context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2)
        context.restore()
      }
      if (elapsed < durationMs) frame = requestAnimationFrame(draw)
      else setDone(true)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [accent, text, reduced])
  return reduced || done ? null : (
    <canvas ref={canvas} className="overlay-confetti" aria-hidden="true" />
  )
}
