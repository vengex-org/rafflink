import { useI18n } from "../i18n/i18n.tsx"

/**
 * The quiet invitation at the foot of the viewer's pages. A full page load, not a router link, so the
 * server sees `ref` on the request for "/" and counts where the visit came from.
 */
export function RunYourOwn() {
  const { t } = useI18n()
  return (
    <div className="run-your-own">
      <a href="/?ref=giveaway">{t("viewer.runYourOwn")}</a>
    </div>
  )
}
