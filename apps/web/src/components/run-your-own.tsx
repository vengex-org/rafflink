import { Link } from "react-router"
import { useI18n } from "../i18n/i18n.tsx"

/** The quiet invitation at the foot of the viewer's pages; `ref` tells the home page where the visit came from. */
export function RunYourOwn() {
  const { t } = useI18n()
  return (
    <div className="run-your-own">
      <Link to="/?ref=giveaway">{t("viewer.runYourOwn")}</Link>
    </div>
  )
}
