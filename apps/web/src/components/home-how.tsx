import type { ReactNode } from "react"
import type { Group } from "@rafflink/core/domain/groups"
import { useI18n } from "../i18n/i18n.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { demoRules, demoViewerName, initialDemoState } from "../lib/demo-script.ts"
import { demoFacts } from "../lib/demo-live.ts"
import { exampleClaimLeftMs } from "../lib/home-example.ts"
import { initialValues, type Values } from "../pages/create-values.ts"
import { TicketsField } from "../pages/create-steps.tsx"
import { Countdown } from "./countdown.tsx"
import { LinkIcon, PlusIcon, ShuffleIcon } from "./icons.tsx"
import { Replay } from "./replay.tsx"
import { ShareLinks } from "./share-panel.tsx"
import { WinnerPlate } from "./winner-plate.tsx"

/** Example ticket counts per group, the ones of the demo giveaway; the streamer sets the real ones for each giveaway. */
export const exampleTiers: readonly { readonly label: MessageKey; readonly tickets: number }[] = [
  { label: "home.group.viewer", tickets: demoRules.tickets.viewer },
  { label: "home.group.t1", tickets: demoRules.tickets.sub_t1 },
  { label: "home.group.t2", tickets: demoRules.tickets.sub_t2 },
  { label: "home.group.t3", tickets: demoRules.tickets.sub_t3 },
]

/** The groups the step 1 preview lists; the others stay at 1 ticket, so the odds line names only a listed group. */
const shownGroups: readonly Group[] = ["viewer", "follower", "sub_t1", "sub_t2"]

const exampleValues: Values = {
  ...initialValues,
  tickets: {
    viewer: String(demoRules.tickets.viewer),
    follower: String(demoRules.tickets.follower),
    sub_t1: String(demoRules.tickets.sub_t1),
    sub_t2: String(demoRules.tickets.sub_t2),
    sub_t3: "1",
    vip: "1",
    moderator: "1",
  },
}

const exampleCode = demoFacts(initialDemoState).code

const noChange = () => {}

/** The "three moves" section: the headline on the left, the steps with their small previews on the right. */
export function HomeHow() {
  const { t } = useI18n()
  return (
    <section className="home-how" id="how" aria-labelledby="home-how-title">
      <div className="home-wrap home-how-grid">
        <div>
          <h2 id="home-how-title">{t("home.how.title")}</h2>
          <p className="home-lede">{t("home.how.lede")}</p>
        </div>
        <ol className="home-steps" aria-label={t("home.how.list")}>
          <Step
            icon={<PlusIcon />}
            title={t("home.how.create.title")}
            text={t("home.how.create.text")}
          >
            <TicketsField
              values={exampleValues}
              setValues={noChange}
              issue={null}
              shown={shownGroups}
            />
          </Step>
          <Step
            icon={<LinkIcon />}
            title={t("home.how.share.title")}
            text={t("home.how.share.text")}
          >
            <ShareLinks code={exampleCode} />
          </Step>
          <Step
            icon={<ShuffleIcon />}
            title={t("home.how.draw.title")}
            text={t("home.how.draw.text")}
          >
            <Replay>
              <div className="step-draw">
                <WinnerPlate name={demoViewerName} />
                <Countdown initialMs={exampleClaimLeftMs} />
              </div>
            </Replay>
          </Step>
        </ol>
      </div>
    </section>
  )
}

function Step({
  icon,
  title,
  text,
  children,
}: {
  readonly icon: ReactNode
  readonly title: string
  readonly text: string
  readonly children: ReactNode
}) {
  return (
    <li className="home-step">
      <div>
        <h3>
          <span className="step-icon">{icon}</span>
          {title}
        </h3>
        <p>{text}</p>
      </div>
      <div className="step-preview" inert aria-hidden="true">
        {children}
      </div>
    </li>
  )
}
