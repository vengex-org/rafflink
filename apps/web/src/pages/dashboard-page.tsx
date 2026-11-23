import { useDeferredValue, useEffect, useState, type FormEvent, type ReactNode } from "react"
import { Link, useLocation, useNavigate } from "react-router"
import type { DashboardGiveaway } from "@rafflink/core/http/json"
import type { RoomStatus } from "@rafflink/core/room/rows"
import {
  addBlock,
  deleteGiveaway,
  deleteStreamerData,
  getBlocks,
  listGiveaways,
  removeBlock,
  setHiddenFromHistory,
  setHistoryIndexed,
  setPublicHistory,
  winnersCsvPath,
  type AddBlockResult,
  type RemoveBlockResult,
} from "../api/client.ts"
import { ConfirmAction } from "../components/confirm-action.tsx"
import { Disclosure } from "../components/disclosure.tsx"
import { DonateLink } from "../components/donate-link.tsx"
import {
  ActivityIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  LinkIcon,
  LockIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "../components/icons.tsx"
import { Failed, Loading, SignIn, Status } from "../components/notice.tsx"
import { StreamerOverlayStyle } from "../components/overlay-style.tsx"
import { ObsSteps, ShareLinks } from "../components/share-panel.tsx"
import { StateCard, type Tone } from "../components/state-card.tsx"
import { StatusChip } from "../components/status-chip.tsx"
import { useStreamerSession } from "../components/streamer-session.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { readNotice } from "../lib/dashboard-notice.ts"
import { giveawayDisplayName } from "../lib/messages.ts"
import { dashboardNewPath, historyPath, livePath } from "../lib/routes.ts"
import { useAction } from "../lib/use-action.ts"
import { useLoad } from "../lib/use-load.ts"
import { useSearchQuery } from "../lib/use-search-query.ts"

/** The signed-in streamer's giveaways for the screen under it; the sign-in prompt, a loading state or a failure otherwise. */
export function DashboardGate({
  children,
}: {
  /** `reload` fetches the list again, after a change the list shows. */
  readonly children: (giveaways: readonly DashboardGiveaway[], reload: () => void) => ReactNode
}) {
  const { result, reload } = useLoad(listGiveaways)
  switch (result.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed onReload={reload} />
    case "ready":
      return result.value === "unauthorized" ? <SignIn /> : children(result.value, reload)
  }
}

export function DashboardPage() {
  // The server's refusal outranks the session, which may not be loaded yet or may be stale.
  const notApproved = readNotice(useLocation().state)?.kind === "not-approved"
  return (
    <DashboardGate>
      {(giveaways, reload) => (
        <GiveawayList giveaways={giveaways} approved={!notApproved} onChanged={reload} />
      )}
    </DashboardGate>
  )
}

function GiveawayList({
  giveaways,
  approved,
  onChanged,
}: {
  readonly giveaways: readonly DashboardGiveaway[]
  /** False once the server refused a create with `streamer_not_approved`; the session, once loaded, has the last word. */
  readonly approved: boolean
  /** Runs after a giveaway or the whole account was deleted. */
  readonly onChanged: () => void
}) {
  const i18n = useI18n()
  const { t } = i18n
  const { donateUrl, streamer } = useStreamerSession()
  // An unknown session is not a refusal: the server still enforces approval on create.
  const canCreate = streamer === null ? approved : streamer.canCreate
  // The refusal in the history entry is out of date once the session says the streamer may create.
  const superseded = !approved && canCreate
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (superseded) navigate({ pathname, search }, { replace: true, state: null })
  }, [superseded, pathname, search, navigate])
  if (giveaways.length === 0) {
    if (!canCreate) {
      return (
        <>
          <div className="page-head">
            <h1>{t("dash.title")}</h1>
          </div>
          <AwaitingApproval />
          <DeleteStreamerData onDeleted={onChanged} />
        </>
      )
    }
    return (
      <>
        <div className="page-head">
          <h1>{t("dash.title")}</h1>
        </div>
        <section className="card dash-empty" aria-labelledby="empty-title">
          <div>
            <h2 id="empty-title">{t("dash.empty.title")}</h2>
            <p>{t("dash.empty.text")}</p>
            <Link className="button large" to={dashboardNewPath()}>
              <PlusIcon />
              {t("dash.empty.button")}
            </Link>
          </div>
          <ol className="explainer">
            <li>
              <strong>{t("dash.empty.create.lead")}</strong> {t("dash.empty.create.rest")}
            </li>
            <li>
              <strong>{t("dash.empty.share.lead")}</strong> {t("dash.empty.share.rest")}
            </li>
            <li>
              <strong>{t("dash.empty.draw.lead")}</strong> {t("dash.empty.draw.rest")}
            </li>
          </ol>
        </section>
        <BlockedAccounts />
        <DeleteStreamerData onDeleted={onChanged} />
      </>
    )
  }
  const pinned = giveaways.filter((giveaway) => giveaway.status !== "drawn")
  const rest = giveaways.filter((giveaway) => giveaway.status === "drawn")
  return (
    <>
      <div className="page-head">
        <h1>{t("dash.title")}</h1>
        {canCreate ? (
          <Link className="button" to={dashboardNewPath()}>
            <PlusIcon />
            {t("dash.new.button")}
          </Link>
        ) : null}
      </div>
      {canCreate ? null : <AwaitingApproval />}
      <section className="dash-style">
        <StreamerOverlayStyle />
      </section>
      {pinned.length === 0 ? null : (
        <section className="dash-section" aria-labelledby="dash-running">
          <h2 id="dash-running">{t("dash.section.running")}</h2>
          <ul className="giveaways pinned">
            {pinned.map((giveaway) => (
              <GiveawayItem
                key={giveaway.id}
                giveaway={giveaway}
                pinned
                canDuplicate={canCreate}
                onChanged={onChanged}
              />
            ))}
          </ul>
        </section>
      )}
      {rest.length === 0 || donateUrl === null ? null : <SupportNote url={donateUrl} />}
      {rest.length === 0 ? null : (
        <FinishedGiveaways giveaways={rest} canDuplicate={canCreate} onChanged={onChanged} />
      )}
      <PublicHistorySetting />
      <BlockedAccounts />
      <DeleteStreamerData onDeleted={onChanged} />
    </>
  )
}

/** The drawn giveaways, newest first, narrowed by a search over name, prize and code that `?q=` keeps. */
function FinishedGiveaways({
  giveaways,
  canDuplicate,
  onChanged,
}: {
  readonly giveaways: readonly DashboardGiveaway[]
  readonly canDuplicate: boolean
  readonly onChanged: () => void
}) {
  const i18n = useI18n()
  const { t } = i18n
  const [query, setQuery] = useSearchQuery()
  const searched = useDeferredValue(query).trim().toLowerCase()
  const found = giveaways.filter((giveaway) =>
    [giveawayDisplayName(i18n, giveaway), giveaway.prize ?? "", giveaway.code].some((text) =>
      text.toLowerCase().includes(searched),
    ),
  )
  return (
    <section className="dash-section" aria-labelledby="dash-drawn">
      <h2 id="dash-drawn">{t("dash.section.drawn")}</h2>
      <div className="dash-search">
        <SearchIcon />
        <input
          type="search"
          value={query}
          autoComplete="off"
          placeholder={t("dash.search.placeholder")}
          aria-label={t("dash.search.label")}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      {found.length === 0 ? (
        <p className="muted">{t("dash.search.none")}</p>
      ) : (
        <ul className="giveaways drawn">
          {found.map((giveaway) => (
            <GiveawayItem
              key={giveaway.id}
              giveaway={giveaway}
              pinned={false}
              canDuplicate={canDuplicate}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

/** Turns the streamer's public history page on or off, and links to it while it is on. */
function PublicHistorySetting() {
  const { t } = useI18n()
  const { streamer, reload: reloadSession } = useStreamerSession()
  const { message, busy, run } = useAction()
  if (streamer === null) return null
  const on = streamer.publicHistory
  return (
    <section className="dash-section dash-history" aria-labelledby="dash-history">
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

/** The accounts the streamer keeps out of every giveaway: the list, a login to add and a Remove button per row. */
function BlockedAccounts() {
  const i18n = useI18n()
  const { t } = i18n
  const { result, reload } = useLoad(getBlocks)
  const [login, setLogin] = useState("")
  const { message, busy, run } = useAction()
  const listed = result.state === "ready" && result.value !== "unauthorized" ? result.value : null

  const add = (event: FormEvent) => {
    event.preventDefault()
    void run(() => addBlock(login), addBlockMessage).then((outcome) => {
      if (outcome === "added" || outcome === "exists" || outcome === "room-unavailable") {
        setLogin("")
        reload()
      }
    })
  }

  return (
    <section className="dash-section dash-blocks" aria-labelledby="dash-blocks">
      <h2 id="dash-blocks">{t("dash.blocks.title")}</h2>
      <p>{t("dash.blocks.text")}</p>
      {result.state === "loading" ? <Loading /> : null}
      {result.state === "failed"
      || (result.state === "ready" && result.value === "unauthorized") ? (
        <>
          <p role="alert">{t("failed.text")}</p>
          <button type="button" className="button text" onClick={reload}>
            {t("common.reloadPage")}
          </button>
        </>
      ) : null}
      {listed === null ? null : (
        <>
          <form className="block-add" onSubmit={add} noValidate>
            <div className="field">
              <label htmlFor="block-login">{t("dash.blocks.label")}</label>
              <input
                id="block-login"
                name="login"
                type="text"
                autoComplete="off"
                value={login}
                onChange={(event) => setLogin(event.currentTarget.value)}
              />
            </div>
            <button type="submit" className="button" disabled={busy}>
              <PlusIcon />
              {t("dash.blocks.add")}
            </button>
          </form>
          <p className="muted">
            {t("dash.blocks.count", {
              count: i18n.number(listed.blocks.length),
              max: i18n.number(listed.blockListMax),
            })}
          </p>
          {listed.blocks.length === 0 ? (
            <p className="muted">{t("dash.blocks.none")}</p>
          ) : (
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
                          if (outcome === "removed") reload()
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
          )}
        </>
      )}
      {message === null ? null : <Status>{t(message)}</Status>}
    </section>
  )
}

function addBlockMessage(outcome: AddBlockResult): MessageKey {
  return outcome === "unauthorized" ? "action.failed" : `dash.blocks.${outcome}`
}

function removeBlockMessage(outcome: RemoveBlockResult): MessageKey {
  return outcome === "unauthorized" ? "action.failed" : `dash.blocks.${outcome}`
}

/** Deletes every giveaway of the streamer and the account; the list then asks to sign in again. */
function DeleteStreamerData({ onDeleted }: { readonly onDeleted: () => void }) {
  const { t } = useI18n()
  const { reload: reloadSession } = useStreamerSession()
  const { message, busy, run } = useAction()
  return (
    <div className="dash-delete-data">
      <h2>{t("dash.deleteData.title")}</h2>
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
    </div>
  )
}

/** What a signed-in streamer sees while signup is closed and no admin has approved the account. */
function AwaitingApproval() {
  const { t } = useI18n()
  return (
    <StateCard tone="warning" align="start" icon={<LockIcon />} title={t("dash.access.title")}>
      <p>{t("dash.access.text")}</p>
    </StateCard>
  )
}

/** A quiet line above the drawn giveaways, the moment a streamer has just seen a giveaway through. */
function SupportNote({ url }: { readonly url: string }) {
  const { t } = useI18n()
  return (
    <p className="support-note">
      {t("dash.support.text")}
      <DonateLink url={url}>{t("dash.support.link")}</DonateLink>
    </p>
  )
}

/** A giveaway still running is a card with filled buttons; a drawn one is a quieter card with text buttons. */
function GiveawayItem({
  giveaway,
  pinned,
  canDuplicate,
  onChanged,
}: {
  readonly giveaway: DashboardGiveaway
  readonly pinned: boolean
  /** False when the streamer may not create giveaways, which also takes away duplicating one. */
  readonly canDuplicate: boolean
  /** Runs after the giveaway was deleted, hidden from the public history or shown there again. */
  readonly onChanged: () => void
}) {
  const i18n = useI18n()
  const { t } = i18n
  const { message, busy, run } = useAction()
  const name = giveawayDisplayName(i18n, giveaway)
  // An untitled giveaway is already named by its prize, so the prize line would repeat it.
  const prizeLine = giveaway.title === null ? null : giveaway.prize
  return (
    <li className="card" data-status={giveaway.status}>
      <div className="giveaway-head">
        <h3>{name}</h3>
        <StatusChip tone={statusTone(giveaway.status)}>{t(`status.${giveaway.status}`)}</StatusChip>
      </div>
      {prizeLine === null ? null : <p>{t("dash.prize", { prize: prizeLine })}</p>}
      <p className="muted giveaway-meta">
        {i18n.rich("dash.codeCreated", {
          code: <span className="code-tag">{giveaway.code}</span>,
          date: i18n.date(giveaway.createdAt),
        })}
      </p>
      {giveaway.delivery === null || giveaway.delivery.claimed === 0 ? null : (
        <p className="muted giveaway-meta">
          {t("dash.delivered", {
            delivered: i18n.number(giveaway.delivery.delivered),
            claimed: i18n.number(giveaway.delivery.claimed),
          })}
        </p>
      )}
      <div className="actions">
        <Link className={pinned ? "button" : "button text"} to={livePath(giveaway.id)}>
          <ActivityIcon />
          {t("dash.openLive")}
        </Link>
        {canDuplicate ? (
          <Link
            className={pinned ? "button outlined" : "button text"}
            aria-label={t("dash.duplicate.label", { name })}
            to={dashboardNewPath({ from: giveaway.id })}
          >
            <CopyIcon />
            {t("dash.duplicate")}
          </Link>
        ) : null}
        {giveaway.status === "drawn" ? (
          <a
            className="button text"
            href={winnersCsvPath(giveaway.id)}
            download
            aria-label={t("dash.csv.label", { name })}
          >
            <DownloadIcon />
            {t("dash.csv")}
          </a>
        ) : null}
        {giveaway.status === "drawn" ? (
          <button
            type="button"
            className="button text"
            disabled={busy}
            aria-label={t(
              giveaway.hiddenFromHistory ? "dash.history.show.label" : "dash.history.hide.label",
              { name },
            )}
            onClick={() =>
              void run(
                () => setHiddenFromHistory(giveaway.id, !giveaway.hiddenFromHistory),
                (outcome) => (outcome === "saved" ? "dash.history.saved" : "action.failed"),
              ).then((outcome) => {
                if (outcome === "saved") onChanged()
              })
            }
          >
            {giveaway.hiddenFromHistory ? <EyeIcon /> : <EyeOffIcon />}
            {t(giveaway.hiddenFromHistory ? "dash.history.show" : "dash.history.hide")}
          </button>
        ) : null}
        <ConfirmAction
          icon={<TrashIcon />}
          label={
            <>
              {t("dash.delete")}
              <span className="sr-only"> {name}</span>
            </>
          }
          question={t("dash.delete.question", { name })}
          detail={t("dash.delete.detail")}
          confirmLabel={t("dash.delete.confirm")}
          busy={busy}
          disabled={false}
          className="button text"
          shortcut={null}
          onConfirm={() =>
            void run(
              () => deleteGiveaway(giveaway.id),
              (outcome) => (outcome === "deleted" ? null : "action.failed"),
            ).then((outcome) => {
              if (outcome === "deleted") onChanged()
            })
          }
        />
      </div>
      {message === null ? null : <Status>{t(message)}</Status>}
      <Disclosure icon={<LinkIcon />} summary={t("dash.linkObs")} open={false}>
        <ShareLinks code={giveaway.code} />
        <ObsSteps giveaway={giveaway} />
      </Disclosure>
    </li>
  )
}

function statusTone(status: RoomStatus): Tone {
  switch (status) {
    case "open":
      return "success"
    case "closed":
      return "warning"
    case "drawn":
      return "win"
  }
}
