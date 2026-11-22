import { useEffect, useState } from "react"
import type { OverlayTheme } from "@rafflink/core/domain/overlay-theme"
import type { LiveWinner } from "@rafflink/core/room/giveaway-room"
import { errorClass } from "@rafflink/core/lib/error-class"

/** The chime of `scripts/reveal-sound.ts`. */
export const revealSoundPath = "/sounds/reveal.wav"

/** The latest winner reveal: `count` of them since the page loaded, with the cues the theme asked for at that moment. */
export interface RevealCue {
  readonly count: number
  readonly sound: boolean
  readonly confetti: boolean
}

/**
 * Counts a reveal when a standing winner the page has not shown appears and no shuffle hides it; the winners
 * standing when the page loads are not a reveal, so reloading the browser source plays nothing. Plays the sound
 * of each reveal when the theme asks for it.
 */
export function useRevealCue(
  standing: readonly LiveWinner[],
  shuffling: boolean,
  theme: Pick<OverlayTheme, "sound" | "confetti">,
): RevealCue {
  const [shown, setShown] = useState<ReadonlySet<number>>(
    () => new Set(standing.map((winner) => winner.n)),
  )
  const [cue, setCue] = useState<RevealCue>({ count: 0, sound: false, confetti: false })
  const fresh = shuffling ? [] : standing.filter((winner) => !shown.has(winner.n))
  if (fresh.length > 0) {
    setShown(new Set([...shown, ...fresh.map((winner) => winner.n)]))
    setCue({ count: cue.count + 1, sound: theme.sound, confetti: theme.confetti })
  }
  useEffect(() => {
    if (cue.count === 0 || !cue.sound) return
    // OBS lets a browser source play sound; a browser tab may refuse until the page is clicked.
    new Audio(revealSoundPath).play().catch((error: unknown) => {
      console.warn("reveal sound not played", { errorClass: errorClass(error) })
    })
  }, [cue])
  return cue
}
