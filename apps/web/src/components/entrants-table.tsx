import { Fragment, useDeferredValue, useId, useMemo, useRef, useState, type ReactNode } from "react"
import { groups, type Group, type Tickets } from "@rafflink/core/domain/groups"
import type { LiveWinner } from "@rafflink/core/room/giveaway-room"
import { useI18n, type I18n } from "../i18n/i18n.tsx"
import { orderEntrants, searchEntrants, type ListedEntrant } from "../lib/entrant-list.ts"
import { useEntrants } from "../lib/use-entrants.ts"
import { useVirtualRows, type RowGeometry } from "../lib/use-virtual-rows.ts"
import { AlertIcon, GiftIcon, RefreshIcon, SearchIcon, UsersIcon } from "./icons.tsx"
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

/** Everyone who entered with their tier, a search and the winners' claim state, as the right-hand panel of the live page. The list stays in step with the live socket. */
export function EntrantsSection({
  entrants,
  entrantCount,
  ticketTotal,
  ticketsPerGroup,
  winners,
}: {
  readonly entrants: ReturnType<typeof useEntrants>
  readonly entrantCount: number
  readonly ticketTotal: number
  /** What each tier is worth, from the giveaway's rules; null while they are not known. */
  readonly ticketsPerGroup: Tickets | null
  readonly winners: readonly LiveWinner[]
}) {
  const i18n = useI18n()
  const { t } = i18n
  const [query, setQuery] = useState("")
  const searched = useDeferredValue(query)
  const ordered = useMemo(() => orderEntrants(entrants.rows, winners), [entrants.rows, winners])
  const standing = useMemo(() => standingWinners(winners), [winners])
  const found = useMemo(() => searchEntrants(ordered, searched), [ordered, searched])
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
    <aside className="live-panel" aria-labelledby="entrants-list-title">
      <div className="live-panel-head">
        <h2 id="entrants-list-title">
          {t("entrants.title")} <span>{i18n.number(entrantCount)}</span>
        </h2>
        <p>{i18n.plural("ticket", ticketTotal)}</p>
      </div>
      <Tiers rows={entrants.rows} ticketsPerGroup={ticketsPerGroup} />
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
            >
              <colgroup>
                <col />
                <col className="entrants-col-status" />
                <col className="entrants-col-tickets" />
              </colgroup>
              <thead className="sr-only">
                <tr>
                  <th scope="col">{t("entrants.col.name")}</th>
                  <th scope="col">{t("entrants.col.status")}</th>
                  <th scope="col">{t("entrants.col.tickets")}</th>
                </tr>
              </thead>
              <tbody>
                <Spacer rows={virtual.first} />
                {found.slice(virtual.first, virtual.end).map((row, offset) => (
                  <EntrantRow
                    key={row.entrant.seq}
                    row={row}
                    index={virtual.first + offset}
                    standing={standing}
                  />
                ))}
                <Spacer rows={found.length - virtual.end} />
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
    </aside>
  )
}

/** How many entrants each tier has, with what a ticket of the tier is worth. Without the rules it lists the tiers that have entrants. */
function Tiers({
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
function Spacer({ rows }: { readonly rows: number }) {
  if (rows <= 0) return null
  return (
    <tr
      aria-hidden="true"
      className="entrants-spacer"
      style={{ height: rows * geometry.rowHeight }}
    >
      <SpacerCell />
    </tr>
  )
}

function SpacerCell() {
  return <td colSpan={3} aria-hidden="true" />
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
}: {
  readonly row: ListedEntrant
  readonly index: number
  readonly standing: readonly LiveWinner[]
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
        <Avatar name={entrant.displayName} />
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
        <span className="entrants-status">
          {winner === null ? t(`tier.${entrant.group}`) : winnerStatus(winner, standing, t)}
        </span>
      </Cell>
      <Cell>
        <span className="entrants-tickets">{i18n.number(entrant.tickets)}</span>
      </Cell>
    </tr>
  )
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
