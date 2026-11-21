import type { DashboardGiveaway } from "@rafflink/core/http/json"
import { useI18n } from "../i18n/i18n.tsx"
import { overlayUrl, shareUrl } from "../lib/links.ts"
import { CopyField } from "./copy-field.tsx"

/** The link and the ready-made chat message the streamer pastes to start collecting entries. */
export function ShareLinks({ code }: { readonly code: string }) {
  const { t } = useI18n()
  return (
    <>
      <CopyField
        label={t("share.link")}
        value={shareUrl(code)}
        buttonLabel={t("share.copyLink")}
        code={code}
      />
      <CopyField
        label={t("share.chat")}
        value={t("share.chatMessage", { url: shareUrl(code) })}
        buttonLabel={t("share.copyChat")}
      />
    </>
  )
}

export function ObsSteps({
  giveaway,
}: {
  readonly giveaway: Pick<DashboardGiveaway, "id" | "overlayToken">
}) {
  const { t } = useI18n()
  return (
    <>
      <ObsStepList />
      <CopyField
        label={t("share.overlay")}
        value={overlayUrl(giveaway.id, giveaway.overlayToken)}
        buttonLabel={t("share.copyOverlay")}
      />
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
