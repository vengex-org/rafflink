import { useId, useState } from "react"
import type { ModeratorLinkJson } from "@rafflink/core/http/json"
import { errorClass } from "@rafflink/core/lib/error-class"
import { reportError } from "../lib/error-reporting.ts"
import { useI18n } from "../i18n/i18n.tsx"
import type { ModeratorLinksApi } from "../lib/live-api.ts"
import { moderatorUrl } from "../lib/links.ts"
import { platformNames } from "../lib/platform-name.ts"
import { featureReconnectPath, livePath } from "../lib/routes.ts"
import type { Doing } from "./live-bar.tsx"
import { CopyLink } from "./copy-field.tsx"
import { Segmented, type SegmentOption } from "./form-fields.tsx"
import { LockIcon, LogInIcon } from "./icons.tsx"
import { InfoTip } from "./info-tip.tsx"
import { Notice } from "./notice.tsx"
import { useStreamerSession } from "./streamer-session.tsx"

/** The short name of a link on the live page, the same in the list and in "who did what". */
export function linkName(linkId: string): string {
  return linkId.slice(0, 6)
}

type Listed =
  | { readonly state: "closed" | "loading" | "failed" }
  | { readonly state: "ready"; readonly links: readonly ModeratorLinkJson[] }

/**
 * The streamer's moderator links in a popover: make one (its URL shows once, the server keeps only a hash),
 * see the ones that work and revoke one. The list loads when the popover opens.
 */
export function ModeratorLinks({
  id,
  busy,
  run,
  api,
  modsOffered,
}: Doing & {
  readonly api: ModeratorLinksApi
  /** The giveaway's platform tells who moderates the channel, so a link can be for its moderators only. */
  readonly modsOffered: boolean
}) {
  const { t, time } = useI18n()
  const popoverId = useId()
  const [listed, setListed] = useState<Listed>({ state: "closed" })
  const [modsChosen, setModsChosen] = useState(true)
  const requireMod = modsOffered && modsChosen
  const [made, setMade] = useState<string | null>(null)
  const [reconnect, setReconnect] = useState(false)
  const whoOptions: readonly SegmentOption<"mods" | "anyone">[] = [
    {
      value: "mods",
      label: t("live.mod.who.mods"),
      icon: null,
      description: t("live.mod.who.mods.help"),
    },
    { value: "anyone", label: t("live.mod.who.anyone"), icon: null, description: "" },
  ]

  const load = async () => {
    setListed({ state: "loading" })
    try {
      setListed({ state: "ready", links: await api.list(id) })
    } catch (error) {
      console.error("moderator links failed", { errorClass: errorClass(error) })
      reportError(error)
      setListed({ state: "failed" })
    }
  }

  const create = async () => {
    const outcome = await run(
      async () => {
        const created = await api.create(id, requireMod)
        setReconnect(created === "reconnect")
        if (created === "rejected" || created === "reconnect") return created
        setMade(moderatorUrl(created.token))
        return "created"
      },
      (kind) => (kind === "rejected" ? "modResult.rejected" : null),
    )
    if (outcome === "created") await load()
  }

  const revoke = async (linkId: string) => {
    const outcome = await run(
      () => api.revoke(id, linkId),
      (kind) => `modResult.${kind}`,
    )
    if (outcome === "revoked") await load()
  }

  return (
    <>
      <button
        type="button"
        className="live-btn ghost"
        popoverTarget={popoverId}
        onClick={() => void load()}
      >
        <LockIcon />
        {t("live.mod.link")}
      </button>
      <div id={popoverId} popover="auto" className="live-overlay live-mod-links">
        <h2>{t("live.mod.link")}</h2>
        <p>{t("live.mod.text")}</p>
        {modsOffered ? (
          <Segmented
            name="moderator-link-who"
            legend={t("live.mod.who")}
            help={null}
            options={whoOptions}
            value={requireMod ? "mods" : "anyone"}
            onSelect={(choice) => setModsChosen(choice === "mods")}
          />
        ) : null}
        <button
          type="button"
          className="live-btn secondary"
          disabled={busy}
          onClick={() => void create()}
        >
          {t("live.mod.create")}
        </button>
        {reconnect && requireMod ? <ModLinksReconnect id={id} /> : null}
        {made === null ? null : (
          <CopyLink label={t("live.mod.new")} value={made} buttonLabel={t("live.mod.copy")} clipped>
            {made}
          </CopyLink>
        )}
        <LinkList
          listed={listed}
          busy={busy}
          onRevoke={(linkId) => void revoke(linkId)}
          time={time}
        />
      </div>
    </>
  )
}

/** A link for moderators only needs the moderators scope, which the streamer grants by signing in again. */
function ModLinksReconnect({ id }: { readonly id: string }) {
  const { t } = useI18n()
  const { streamer } = useStreamerSession()
  const platform = streamer?.platform ?? "twitch"
  const button = t("wizard.reconnect.button", { platform: platformNames[platform] })
  return (
    <Notice tone="warning">
      <p>
        {t("live.mod.reconnect")}{" "}
        <InfoTip topic={button} text={t("wizard.reconnect.modlinks.info")} />
      </p>
      <div className="notice-action">
        <a
          className="button outlined"
          href={featureReconnectPath(platform, ["modlinks"], livePath(id))}
        >
          <LogInIcon />
          {button}
        </a>
      </div>
    </Notice>
  )
}

function LinkList({
  listed,
  busy,
  onRevoke,
  time,
}: {
  readonly listed: Listed
  readonly busy: boolean
  readonly onRevoke: (linkId: string) => void
  readonly time: (ms: number) => string
}) {
  const { t } = useI18n()
  switch (listed.state) {
    case "closed":
    case "loading":
      return null
    case "failed":
      return <p role="alert">{t("live.mod.loadFailed")}</p>
    case "ready":
      return listed.links.length === 0 ? (
        <p>{t("live.mod.none")}</p>
      ) : (
        <ul className="live-mod-list">
          {listed.links.map((link) => (
            <li key={link.id}>
              <span>
                {t("live.mod.item", { id: linkName(link.id), time: time(link.createdAt) })}
                {link.requireMod ? ` · ${t("live.mod.itemMod")}` : null}
              </span>
              <button
                type="button"
                className="live-btn ghost"
                disabled={busy}
                aria-label={t("live.mod.revokeLabel", { id: linkName(link.id) })}
                onClick={() => onRevoke(link.id)}
              >
                {t("live.mod.revoke")}
              </button>
            </li>
          ))}
        </ul>
      )
  }
}
