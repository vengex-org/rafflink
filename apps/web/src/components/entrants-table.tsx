import { Fragment, useDeferredValue, useId, useMemo, useRef, useState, type ReactNode } from "react"
import { useParams } from "react-router"
import { groups, type Group, type Tickets } from "@rafflink/core/domain/groups"
import type { LiveSnapshot, LiveWinner } from "@rafflink/core/room/giveaway-room"
import type { SubscriberBadges } from "@rafflink/core/twitch/channel-badges"
import { useI18n, type I18n } from "../i18n/i18n.tsx"
import { orderEntrants, searchEntrants, type ListedEntrant } from "../lib/entrant-list.ts"
import { useEntrants } from "../lib/use-entrants.ts"
import { useSearchQuery } from "../lib/use-search-query.ts"
import { useSubscriberBadges } from "../lib/use-subscriber-badges.ts"
import { useVirtualRows, type RowGeometry } from "../lib/use-virtual-rows.ts"
import { AlertIcon, GiftIcon, RefreshIcon, SearchIcon, UsersIcon } from "./icons.tsx"
import { isUnsettled, PickActions, type Doing } from "./live-bar.tsx"
import { Avatar } from "./live-parts.tsx"
import { StateCard } from "./state-card.tsx"
import { standingWinners } from "../lib/standing-winners.ts"

/** Every row is this tall, in px, and live.css gives the row the same height, so the visible window is computed, not measured. */
export const entrantRowHeight = 58

// The viewport is the tallest the list can be on a 1080p stream: twenty rows; the box itself is sized by the page.
const geometry: RowGeometry = {
  rowHeight: entrantRowHeight,
  viewportHeight: entrantRowHeight * 20,
  overscan: 6,
}

/** Everyone who entered with their tier, a search and the winners' claim state, in the main column of the live page. The list stays in step with the live socket. `controls` adds the mark and reroll buttons to the rows of the winners still unsettled, except `current`, whose buttons are in the draw toolbar; null hides them (clean mode). */
export function EntrantsSection({
  entrants,
  snapshot,
  current,
  controls,
}: {
  readonly entrants: ReturnType<typeof useEntrants>
  readonly snapshot: LiveSnapshot
  readonly current: LiveWinner | null
  readonly controls: Doing | null
}) {
  const i18n = useI18n()
  const { t } = i18n
  const [query, setQuery] = useSearchQuery()
  const searched = useDeferredValue(query)
  const { entrantCount, ticketTotal, winners } = snapshot
  const ordered = useMemo(() => orderEntrants(entrants.rows, winners), [entrants.rows, winners])
  const standing = useMemo(() => standingWinners(winners), [winners])
  // Only winners whose entrant has a row count: a pick without a row would leave an empty column.
  const acting =
    controls !== null
    && ordered.some(
      ({ winner }) => winner !== null && winner.n !== current?.n && isUnsettled(winner),
    )
  const found = useMemo(() => searchEntrants(ordered, searched), [ordered, searched])
  const badges = useSubscriberBadges(useParams().id)
  const scroller = useRef<HTMLDivElement>(null)
  const virtual = useVirtualRows(found.length, geometry)
  const backToTop = () => {
    if (scroller.current !== null) scroller.current.scrollTop = 0
    virtual.reset()
  }
  const searchId = useId()
  const searching = searched.trim() !== ""
  const loadingFirstPage = entrants.rows.length === 0 && entrants.phase === "loading"

  return (
    <section className="live-panel" aria-labelledby="entrants-list-title">
      <div className="live-panel-head">
        <h2 id="entrants-list-title">
          {t("entrants.title")} <span>{i18n.number(entrantCount)}</span>
        </h2>
        <p>{i18n.plural("ticket", ticketTotal)}</p>
      </div>
      <div className="live-search">
        <SearchIcon />
        <input
          id={searchId}
          type="search"
          value={query}
          autoComplete="off"
          placeholder={t("entrants.search.placeholder")}
          aria-label={t("entrants.search.label")}
          aria-describedby={`${searchId}-help`}
          onChange={(event) => {
            setQuery(event.currentTarget.value)
            backToTop()
          }}
        />
        <p id={`${searchId}-help`} className="sr-only">
          {t("entrants.search.help")}
        </p>
      </div>
      <div className="live-panel-body">
        {entrants.phase === "failed" ? (
          <StateCard
            tone="danger"
            align="center"
            icon={<AlertIcon />}
            title={t("entrants.failed.title")}
          >
            <p role="alert">{t("entrants.failed.text")}</p>
            <button type="button" className="button" onClick={entrants.retry}>
              <RefreshIcon />
              {t("entrants.retry")}
            </button>
          </StateCard>
        ) : null}
        {loadingFirstPage ? (
          <StateCard
            tone="info"
            align="center"
            icon={<span className="spinner" aria-hidden="true" />}
            title={t("entrants.loading.title")}
          >
            <p>
              <output>{t("entrants.loading.text")}</output>
            </p>
          </StateCard>
        ) : null}
        {entrants.rows.length === 0 && entrants.phase === "ready" ? (
          <StateCard
            tone="info"
            align="center"
            icon={<UsersIcon />}
            title={t("entrants.empty.title")}
          >
            <p>{t("entrants.empty.text")}</p>
          </StateCard>
        ) : null}
        {entrants.rows.length > 0 && found.length === 0 ? (
          <StateCard
            tone="info"
            align="center"
            icon={<GiftIcon />}
            title={t("entrants.noMatch.title")}
          >
            <p>{t("entrants.noMatch.text")}</p>
            <button
              type="button"
              className="button tonal"
              onClick={() => {
                setQuery("")
                backToTop()
              }}
            >
              {t("entrants.clear")}
            </button>
          </StateCard>
        ) : null}
        {found.length > 0 ? (
          <div ref={scroller} className="entrants-scroll" onScroll={virtual.onScroll}>
            <table
              aria-label={t("entrants.list.aria")}
              aria-rowcount={found.length + 1}
              className="entrants-table"
              data-actions={acting ? "" : undefined}
            >
              <colgroup>
                <col />
                <col className="entrants-col-status" />
                <col className="entrants-col-tickets" />
                {acting ? <col className="entrants-col-actions" /> : null}
              </colgroup>
              <thead className="sr-only">
                <tr>
                  <th scope="col">{t("entrants.col.name")}</th>
                  <th scope="col">{t("entrants.col.status")}</th>
                  <th scope="col">{t("entrants.col.tickets")}</th>
                  {acting ? <th scope="col">{t("entrants.col.actions")}</th> : null}
                </tr>
              </thead>
              <tbody>
                <Spacer rows={virtual.first} columns={acting ? 4 : 3} />
                {found.slice(virtual.first, virtual.end).map((row, offset) => (
                  <EntrantRow
                    key={row.entrant.seq}
                    row={row}
                    index={virtual.first + offset}
                    standing={standing}
                    badges={badges}
                    snapshot={snapshot}
                    current={current}
                    controls={acting ? controls : null}
                  />
                ))}
                <Spacer rows={found.length - virtual.end} columns={acting ? 4 : 3} />
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
      {loadingFirstPage ? null : (
        <div className="live-panel-foot">
          <span aria-live={searching ? "polite" : "off"}>
            {t("entrants.showing", {
              shown: i18n.number(found.length),
              total: i18n.number(ordered.length),
            })}
          </span>
          <span>{t("entrants.sort")}</span>
        </div>
      )}
    </section>
  )
}

/** How many entrants each tier has, with what a ticket of the tier is worth. Without the rules (`ticketsPerGroup` null while they load) it lists the tiers that have entrants. */
export function Tiers({
  rows,
  ticketsPerGroup,
}: {
  readonly rows: readonly { readonly group: Group }[]
  readonly ticketsPerGroup: Tickets | null
}) {
  const { t, number } = useI18n()
  const counts = useMemo(() => {
    const byGroup = new Map<Group, number>()
    for (const { group } of rows) byGroup.set(group, (byGroup.get(group) ?? 0) + 1)
    return byGroup
  }, [rows])
  const shown = groups.filter((group) =>
    ticketsPerGroup === null ? counts.has(group) : ticketsPerGroup[group] > 0,
  )
  if (shown.length === 0) return null
  return (
    <ul className="live-tiers" aria-label={t("entrants.tiers")}>
      {shown.map((group) => (
        <li key={group}>
          <span className="live-tier-name">{t(`tier.${group}`)}</span>
          <span className="live-tier-count">
            <span>{number(counts.get(group) ?? 0)}</span>
            {ticketsPerGroup === null ? null : <small>x{number(ticketsPerGroup[group])}</small>}
          </span>
        </li>
      ))}
    </ul>
  )
}

// Stands in for the rows that are not rendered, so the scroll box keeps the height of the whole list.
function Spacer({ rows, columns }: { readonly rows: number; readonly columns: number }) {
  if (rows <= 0) return null
  return (
    <tr
      aria-hidden="true"
      className="entrants-spacer"
      style={{ height: rows * geometry.rowHeight }}
    >
      <td colSpan={columns} aria-hidden="true" />
    </tr>
  )
}

// The cell's box is the row height, so one row never grows with its content.
function Cell({ children }: { readonly children: ReactNode }) {
  return (
    <td>
      <div className="entrants-cell">{children}</div>
    </td>
  )
}

function EntrantRow({
  row,
  index,
  standing,
  badges,
  snapshot,
  current,
  controls,
}: {
  readonly row: ListedEntrant
  readonly index: number
  readonly standing: readonly LiveWinner[]
  readonly badges: SubscriberBadges | null
  readonly snapshot: LiveSnapshot
  readonly current: LiveWinner | null
  /** Null when no row in the list has buttons, so the table has no actions column. */
  readonly controls: Doing | null
}) {
  const i18n = useI18n()
  const { t } = i18n
  const { entrant, winner } = row
  // Twitch display names are a login in other capitals; the login shows only when the two differ.
  const showLogin = entrant.login.toLowerCase() !== entrant.displayName.toLowerCase()
  const name = row.displayName?.positions ?? (showLogin ? null : (row.login?.positions ?? null))
  return (
    <tr
      // The header row is row 1.
      aria-rowindex={index + 2}
      data-claim={winner?.claim.state}
    >
      <Cell>
        <Avatar name={entrant.displayName} imageUrl={entrant.profileImageUrl} />
        <span className="entrants-primary">
          <Marked text={entrant.displayName} positions={name} />
        </span>
        {showLogin ? (
          <span className="entrants-secondary">
            <Marked text={entrant.login} positions={row.login?.positions ?? null} />
          </span>
        ) : null}
      </Cell>
      <Cell>
        <SubscriberBadge group={entrant.group} badges={badges} />
        <span className="entrants-status">
          {winner === null ? t(`tier.${entrant.group}`) : winnerStatus(winner, standing, t)}
        </span>
      </Cell>
      <Cell>
        <span className="entrants-tickets">{i18n.number(entrant.tickets)}</span>
      </Cell>
      {controls === null ? null : (
        <Cell>
          {winner === null || winner.n === current?.n ? null : (
            <PickActions {...controls} snapshot={snapshot} winner={winner} />
          )}
        </Cell>
      )}
    </tr>
  )
}

const subscriberChips: Readonly<Record<keyof SubscriberBadges, string>> = {
  sub_t1: "T1",
  sub_t2: "T2",
  sub_t3: "T3",
}

/** The channel's badge of a subscriber's tier, or a tier chip when the badge is not known or does not load; nothing for an entrant who is not in a subscriber group. The tier is written beside it, so it is hidden from screen readers. */
function SubscriberBadge({
  group,
  badges,
}: {
  readonly group: Group
  readonly badges: SubscriberBadges | null
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  if (!isSubscriberGroup(group)) return null
  const image = badges?.[group] ?? null
  if (image === null || image === failedUrl) {
    return (
      <span className="entrants-tier-chip" aria-hidden="true">
        {subscriberChips[group]}
      </span>
    )
  }
  return (
    <img
      className="entrants-badge"
      src={image}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      aria-hidden="true"
      onError={() => setFailedUrl(image)}
    />
  )
}

function isSubscriberGroup(group: Group): group is keyof SubscriberBadges {
  return Object.hasOwn(subscriberChips, group)
}

/** A winner's row says who they are in the draw while the claim is open, and how it ended after. */
function winnerStatus(winner: LiveWinner, standing: readonly LiveWinner[], t: I18n["t"]): string {
  switch (winner.claim.state) {
    case "waiting":
      return t("entrants.winner", { n: standing.indexOf(winner) + 1 })
    case "claimed":
      return t("entrants.status.claimed")
    case "expired":
      return t("entrants.status.expired")
    case "rerolled":
      return t("entrants.status.rerolled")
  }
}

/** `text` with the characters at `positions` (indexes in `Array.from(text)`) highlighted. */
function Marked({
  text,
  positions,
}: {
  readonly text: string
  readonly positions: readonly number[] | null
}): ReactNode {
  if (positions === null || positions.length === 0) return text
  const matched = new Set(positions)
  const parts: { text: string; marked: boolean }[] = []
  for (const [index, char] of Array.from(text).entries()) {
    const marked = matched.has(index)
    const last = parts.at(-1)
    if (last !== undefined && last.marked === marked) last.text += char
    else parts.push({ text: char, marked })
  }
  return parts.map((part, index) => (
    <Fragment key={index}>{part.marked ? <mark>{part.text}</mark> : part.text}</Fragment>
  ))
}
