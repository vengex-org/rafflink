import { errorClass } from "@rafflink/core/lib/error-class"
import { reportError } from "./error-reporting.ts"
import type { SubscriberBadges } from "@rafflink/core/platform/provider"
import { useEffect, useState } from "react"
import { useLiveApi } from "./live-api.ts"

/** The channel's subscriber badges, read once when the page opens; `null` while they load and when they could not be read, so the rows show a tier chip instead. */
export function useSubscriberBadges(giveawayId: string | undefined): SubscriberBadges | null {
  const [badges, setBadges] = useState<SubscriberBadges | null>(null)
  const { getBadges } = useLiveApi()

  useEffect(() => {
    if (giveawayId === undefined) return
    let current = true
    getBadges(giveawayId).then(
      (value) => {
        if (current) setBadges(value)
      },
      (error: unknown) => {
        console.error("subscriber badges failed", { errorClass: errorClass(error) })
        reportError(error)
      },
    )
    return () => {
      current = false
    }
  }, [giveawayId, getBadges])

  return badges
}
