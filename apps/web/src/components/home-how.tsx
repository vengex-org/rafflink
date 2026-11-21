import type { ReactNode } from "react"
import { useI18n } from "../i18n/i18n.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { claimPresets, initialValues } from "../pages/create-values.ts"
import { exampleClock, exampleWinner } from "./home-stage.tsx"
import { CopyIcon, LinkIcon, PlusIcon, ShuffleIcon } from "./icons.tsx"

/** Example ticket counts per group; the streamer sets the real ones for each giveaway. */
export const exampleTiers: readonly { readonly label: MessageKey; readonly tickets: number }[] = [
  { label: "home.group.viewer", tickets: 1 },
  { label: "home.group.t1", tickets: 2 },
  { label: "home.group.t2", tickets: 3 },
  { label: "home.group.t3", tickets: 5 },
]

const exampleCode = "K7HQ2"
const exampleChat = [
  { name: "lenka_hra", tickets: 5 },
  { name: "pixelbara", tickets: 2 },
  { name: "nightjar_77", tickets: 1 },
] as const

/** The "three moves" section: the headline and demo link on the left, the steps with their small previews on the right. */
export function HomeHow() {
  const { t, plural } = useI18n()
  return (
    <section className="home-how" id="how" aria-labelledby="home-how-title">
      <div className="home-wrap home-how-grid">
        <div>
          <h2 id="home-how-title">{t("home.how.title")}</h2>
          <p className="home-lede">{t("home.how.lede")}</p>
          <a className="button outlined home-demo" href="#how">
            {t("home.how.demo")}
          </a>
        </div>
        <ol className="home-steps" aria-label={t("home.how.list")}>
          <Step
            icon={<PlusIcon />}
            title={t("home.how.create.title")}
            text={t("home.how.create.text")}
          >
            <table className="step-tickets">
              <thead>
                <tr>
                  <th>{t("home.how.who")}</th>
                  <th>{t("home.how.tickets")}</th>
                </tr>
              </thead>
              <tbody>
                {exampleTiers.map(({ label, tickets }) => (
                  <tr key={label}>
                    <td>{t(label)}</td>
                    <td>{tickets}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="step-chips">
              {t("home.how.claimTime")}
              {claimPresets.map((seconds) => (
                <span
                  key={seconds}
                  className="step-chip"
                  data-on={seconds === initialValues.claimSeconds}
                >
                  {t("home.how.minutes", { count: seconds / 60 })}
                </span>
              ))}
            </div>
          </Step>
          <Step
            icon={<LinkIcon />}
            title={t("home.how.share.title")}
            text={t("home.how.share.text")}
          >
            <div className="step-url">
              <code>
                rafflink.app/g/<em>{exampleCode}</em>
              </code>
              <span className="step-copy">
                <CopyIcon />
                {t("home.how.copy")}
              </span>
            </div>
            <div className="step-chat">
              {exampleChat.map(({ name, tickets }) => (
                <div key={name}>
                  <b>{name}</b> {t("home.how.entered", { tickets: plural("ticket", tickets) })}
                </div>
              ))}
            </div>
          </Step>
          <Step
            icon={<ShuffleIcon />}
            title={t("home.how.draw.title")}
            text={t("home.how.draw.text")}
          >
            <div className="step-draw">
              <div>
                <div className="step-draw-label">{t("home.preview.winner")}</div>
                <span className="step-draw-name">{exampleWinner}</span>
              </div>
              <div className="step-draw-clock">
                <strong>{exampleClock}</strong>
                <span>{t("home.stage.toClaim")}</span>
              </div>
              <div className="step-draw-bar">
                <span data-on="true">{t("home.how.drawWinner")}</span>
                <span>{t("home.how.reroll")}</span>
                <span>{t("home.how.entriesClosed")}</span>
              </div>
            </div>
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
      <div className="step-preview">{children}</div>
    </li>
  )
}
