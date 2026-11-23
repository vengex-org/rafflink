import { useState, type FormEvent } from "react"
import { Link } from "react-router"
import type { BlockListJson } from "@rafflink/core/http/json"
import {
  addBlock,
  deleteStreamerData,
  getBlocks,
  removeBlock,
  setHistoryIndexed,
  setPublicHistory,
  type AddBlockResult,
  type RemoveBlockResult,
} from "../api/client.ts"
import { ConfirmAction } from "../components/confirm-action.tsx"
import { PlusIcon, TrashIcon } from "../components/icons.tsx"
import { InfoTip } from "../components/info-tip.tsx"
import { Failed, Loading, SignIn, Status } from "../components/notice.tsx"
import { StreamerOverlayStyle } from "../components/overlay-style.tsx"
import { useStreamerSession } from "../components/streamer-session.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { historyPath } from "../lib/routes.ts"
import { useAction } from "../lib/use-action.ts"
import { useLoad } from "../lib/use-load.ts"

/** The streamer's account settings: public history, blocked accounts, overlay style and deleting the account. */
export function SettingsPage() {
  const { t } = useI18n()
  // The block list answers 401 without a session, so it gates the page like the giveaway list gates the dashboard.
  const { result, reload } = useLoad(getBlocks)
  switch (result.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed onReload={reload} />
    case "ready":
      return result.value === "unauthorized" ? (
        <SignIn />
      ) : (
        <>
          <div className="page-head">
            <h1>{t("dash.settings.title")}</h1>
          </div>
          <PublicHistorySetting />
          <BlockedAccounts listed={result.value} onChanged={reload} />
          <section className="dash-section" aria-label={t("overlayStyle.dash.summary")}>
            <StreamerOverlayStyle />
          </section>
          <DeleteStreamerData onDeleted={reload} />
        </>
      )
  }
}

/** Turns the streamer's public history page on or off, and links to it while it is on. */
function PublicHistorySetting() {
  const { t } = useI18n()
  const { streamer, reload: reloadSession } = useStreamerSession()
  const { message, busy, run } = useAction()
  if (streamer === null) return null
  const on = streamer.publicHistory
  return (
    <section className="dash-section" aria-labelledby="dash-history">
      <h2 id="dash-history">{t("dash.history.title")}</h2>
      <p>{t("dash.history.text")}</p>
      {on ? (
        <p>
          <Link to={historyPath(streamer.platform, streamer.login)}>{t("dash.history.link")}</Link>
        </p>
      ) : null}
      <button
        type="button"
        className="button outlined"
        disabled={busy}
        onClick={() =>
          void run(
            () => setPublicHistory(!on),
            (outcome) => (outcome === "saved" ? "dash.history.saved" : "action.failed"),
          ).then((outcome) => {
            if (outcome === "saved") reloadSession()
          })
        }
      >
        {t(on ? "dash.history.turnOff" : "dash.history.turnOn")}
      </button>
      {message === null ? null : <Status>{t(message)}</Status>}
      {on ? <HistoryIndexingSetting indexed={streamer.historyIndexed} /> : null}
    </section>
  )
}

/** Lets search engines index the public history page, or stops them; only while the page is on. */
function HistoryIndexingSetting({ indexed }: { readonly indexed: boolean }) {
  const { t } = useI18n()
  const { reload: reloadSession } = useStreamerSession()
  const { message, busy, run } = useAction()
  return (
    <>
      <p>{t(indexed ? "dash.history.indexed" : "dash.history.notIndexed")}</p>
      <button
        type="button"
        className="button outlined"
        disabled={busy}
        onClick={() =>
          void run(
            () => setHistoryIndexed(!indexed),
            (outcome) => (outcome === "saved" ? "dash.history.saved" : "action.failed"),
          ).then((outcome) => {
            if (outcome === "saved") reloadSession()
          })
        }
      >
        {t(indexed ? "dash.history.stopIndexing" : "dash.history.allowIndexing")}
      </button>
      {message === null ? null : <Status>{t(message)}</Status>}
    </>
  )
}

/** The accounts the streamer keeps out of every giveaway: a login to add, then the list with a Remove button per row. */
function BlockedAccounts({
  listed,
  onChanged,
}: {
  readonly listed: BlockListJson
  /** Loads the list again after an account was added or removed. */
  readonly onChanged: () => void
}) {
  const i18n = useI18n()
  const { t } = i18n
  const [login, setLogin] = useState("")
  const { message, busy, run } = useAction()

  const add = (event: FormEvent) => {
    event.preventDefault()
    void run(() => addBlock(login), addBlockMessage).then((outcome) => {
      if (outcome === "added" || outcome === "exists" || outcome === "room-unavailable") {
        setLogin("")
        onChanged()
      }
    })
  }

  return (
    <section className="dash-section" aria-labelledby="dash-blocks">
      <h2 id="dash-blocks">{t("dash.blocks.title")}</h2>
      <div className="with-info">
        <p>{t("dash.blocks.text")}</p>
        <InfoTip topic={t("dash.blocks.title")} text={t("dash.blocks.info")} />
      </div>
      <form className="block-add" onSubmit={add} noValidate>
        <label htmlFor="block-login">{t("dash.blocks.label")}</label>
        <input
          id="block-login"
          name="login"
          type="text"
          autoComplete="off"
          value={login}
          onChange={(event) => setLogin(event.currentTarget.value)}
        />
        <button type="submit" className="button" disabled={busy}>
          <PlusIcon />
          {t("dash.blocks.add")}
        </button>
      </form>
      {message === null ? null : <Status>{t(message)}</Status>}
      {listed.blocks.length === 0 ? (
        <p className="muted">{t("dash.blocks.none")}</p>
      ) : (
        <>
          <ul className="block-list">
            {listed.blocks.map((block) => (
              <li key={block.platformUserId}>
                <span>
                  {block.login}
                  <span className="muted">
                    {" "}
                    {t("dash.blocks.since", { date: i18n.date(block.createdAt) })}
                  </span>
                </span>
                <button
                  type="button"
                  className="button text"
                  disabled={busy}
                  aria-label={t("dash.blocks.remove.label", { login: block.login })}
                  onClick={() =>
                    void run(() => removeBlock(block.platformUserId), removeBlockMessage).then(
                      (outcome) => {
                        if (outcome === "removed") onChanged()
                      },
                    )
                  }
                >
                  <TrashIcon />
                  {t("dash.blocks.remove")}
                </button>
              </li>
            ))}
          </ul>
          <p className="muted">
            {t("dash.blocks.count", {
              count: i18n.number(listed.blocks.length),
              max: i18n.number(listed.blockListMax),
            })}
          </p>
        </>
      )}
    </section>
  )
}

function addBlockMessage(outcome: AddBlockResult): MessageKey {
  return outcome === "unauthorized" ? "action.failed" : `dash.blocks.${outcome}`
}

function removeBlockMessage(outcome: RemoveBlockResult): MessageKey {
  return outcome === "unauthorized" ? "action.failed" : `dash.blocks.${outcome}`
}

/** Deletes every giveaway of the streamer and the account; the page then asks to sign in again. */
function DeleteStreamerData({ onDeleted }: { readonly onDeleted: () => void }) {
  const { t } = useI18n()
  const { reload: reloadSession } = useStreamerSession()
  const { message, busy, run } = useAction()
  return (
    <section className="dash-section dash-delete-data" aria-labelledby="dash-delete-data">
      <h2 id="dash-delete-data">{t("dash.deleteData.title")}</h2>
      <p>{t("dash.deleteData.text")}</p>
      <ConfirmAction
        icon={<TrashIcon />}
        label={t("dash.deleteData.button")}
        question={t("dash.deleteData.question")}
        detail={t("dash.deleteData.detail")}
        confirmLabel={t("dash.deleteData.confirm")}
        busy={busy}
        disabled={false}
        className="button outlined"
        shortcut={null}
        onConfirm={() =>
          void run(deleteStreamerData, (outcome) =>
            outcome === "deleted" ? null : "action.failed",
          ).then((outcome) => {
            if (outcome !== "deleted") return
            reloadSession()
            onDeleted()
          })
        }
      />
      {message === null ? null : <Status>{t(message)}</Status>}
    </section>
  )
}
