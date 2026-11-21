import type { DashboardGiveaway } from "@rafflink/core/http/json"
import { useI18n } from "../i18n/i18n.tsx"
import { overlayUrl, shareUrl } from "../lib/links.ts"
import { CopyLink } from "./copy-field.tsx"

/** The link the streamer pastes to start collecting entries. */
export function ShareLinks({ code }: { readonly code: string }) {
  const { t } = useI18n()
  const url = shareUrl(code)
  return (
    <CopyLink label={t("share.link")} value={url} buttonLabel={t("share.copyLink")} clipped={false}>
      {new URL(url).host}/<wbr />
      <em>{code}</em>
    </CopyLink>
  )
}

export function ObsSteps({
  giveaway,
}: {
  readonly giveaway: Pick<DashboardGiveaway, "id" | "overlayToken">
}) {
  const { t } = useI18n()
  const url = overlayUrl(giveaway.id, giveaway.overlayToken)
  return (
    <>
      <ObsStepList />
      <CopyLink label={t("share.overlay")} value={url} buttonLabel={t("share.copyOverlay")} clipped>
        {url}
      </CopyLink>
    </>
  )
}

export function ObsStepList() {
  const { t } = useI18n()
  return (
    <ol className="how-to">
      <li>{t("share.obs.1")}</li>
      <li>{t("share.obs.2")}</li>
      <li>{t("share.obs.3")}</li>
      <li>{t("share.obs.4")}</li>
    </ol>
  )
}
