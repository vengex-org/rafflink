import type { DashboardGiveaway } from "@rafflink/core/http/json"
import { chatMessage, overlayUrl, shareUrl } from "../lib/links.ts"
import { CopyField } from "./copy-field.tsx"

/** The link and the ready-made chat message the streamer pastes to start collecting entries. */
export function ShareLinks({ code }: { readonly code: string }) {
  return (
    <>
      <CopyField label="Your link" value={shareUrl(code)} buttonLabel="Copy link" />
      <CopyField
        label="Message for your chat"
        value={chatMessage(code)}
        buttonLabel="Copy chat message"
      />
    </>
  )
}

export function ObsSteps({
  giveaway,
}: {
  readonly giveaway: Pick<DashboardGiveaway, "id" | "overlayToken">
}) {
  return (
    <>
      <ol className="how-to">
        <li>In OBS, find the Sources box and press the + button.</li>
        <li>Choose Browser and press OK.</li>
        <li>Paste the overlay link below into the URL box.</li>
        <li>Set Width to 800 and Height to 600, then press OK.</li>
      </ol>
      <CopyField
        label="Overlay link"
        value={overlayUrl(giveaway.id, giveaway.overlayToken)}
        buttonLabel="Copy overlay link"
      />
    </>
  )
}
