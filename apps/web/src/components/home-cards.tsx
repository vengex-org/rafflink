import { useI18n } from "../i18n/i18n.tsx"
import { repositoryUrl, setupGuideUrl } from "../lib/links.ts"
import { exampleTiers } from "./home-how.tsx"

/** The two cards under the steps: how tickets work, and the self-host card with the deploy command. */
export function HomeCards() {
  const { t, plural } = useI18n()
  return (
    <section className="home-cards">
      <div className="home-wrap home-cards-grid">
        <section className="home-panel" aria-labelledby="home-tickets-title">
          <h2 id="home-tickets-title">{t("home.tickets.title")}</h2>
          <p>{t("home.tickets.text")}</p>
          <dl className="home-tiers">
            {exampleTiers.map(({ label, tickets }) => (
              <div key={label}>
                <dt>{t(label)}</dt>
                <dd>{plural("ticket", tickets)}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section
          className="home-panel home-panel-dark"
          id="self-host"
          aria-labelledby="home-self-host-title"
        >
          <h2 id="home-self-host-title">{t("home.selfhost.title")}</h2>
          <p>{t("home.selfhost.text")}</p>
          <div className="home-panel-links">
            <a className="home-panel-primary" href={setupGuideUrl}>
              {t("home.setupGuide")}
            </a>
            <a href={repositoryUrl}>{t("nav.github")}</a>
          </div>
          <div className="home-terminal">
            <span>$</span> bunx wrangler deploy
            <br />
            <span>Deployed rafflink to your workers.dev domain</span>
          </div>
        </section>
      </div>
    </section>
  )
}
