import { Fragment, useDeferredValue, useId, useMemo, useRef, useState, type ReactNode } from "react"
import type { LiveWinner } from "@rafflink/core/room/giveaway-room"
import { useI18n } from "../i18n/i18n.tsx"
import { orderEntrants, searchEntrants, type ListedEntrant } from "../lib/entrant-list.ts"
import { peopleText } from "../lib/rules-text.ts"
import { useEntrants, type EntrantsFeed } from "../lib/use-entrants.ts"
import { useVirtualRows, type RowGeometry } from "../lib/use-virtual-rows.ts"
import { AlertIcon, GiftIcon, RefreshIcon, UsersIcon } from "./icons.tsx"
import { ClaimClock, claimIcon, claimLabel } from "./live-parts.tsx"
import { StateCard } from "./state-card.tsx"

// Every row is `rowHeight` tall (two lines and padding, at least a thumb target; 72px in components.css too) so
// the visible window is computed, not measured; the table shows eight rows and renders those plus the overscan.
const geometry: RowGeometry = { rowHeight: 72, viewportHeight: 72 * 8, overscan: 6 }

/** Everyone who entered, with a search and the winners' claim state. The list stays in step with the live socket. */
export function EntrantsSection({
  id,
  feed,
  winners,
}: {
  readonly id: string
  readonly feed: EntrantsFeed
  readonly winners: readonly LiveWinner[]
}) {
  const i18n = useI18n()
  const { t } = i18n
  const entrants = useEntrants(id, feed)
  const [query, setQuery] = useState("")
  const searched = useDeferredValue(query)
  const ordered = useMemo(() => orderEntrants(entrants.rows, winners), [entrants.rows, winners])
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
    <section className="entrants" aria-labelledby="entrants-list-title">
      <h2 id="entrants-list-title">{t("entrants.title")}</h2>
      <div className="field">
        <label htmlFor={searchId}>{t("entrants.search.label")}</label>
        <p id={`${searchId}-help`} className="help">
          {t("entrants.search.help")}
        </p>
        <input
          id={searchId}
          type="search"
          value={query}
          autoComplete="off"
          aria-describedby={`${searchId}-help`}
          onChange={(event) => {
            setQuery(event.currentTarget.value)
            backToTop()
          }}
        />
      </div>
      {loadingFirstPage ? null : (
        <p className="entrants-count" aria-live={searching ? "polite" : "off"}>
          {searching
            ? t("entrants.matches", {
                shown: i18n.number(found.length),
                total: i18n.number(ordered.length),
              })
            : peopleText(i18n, ordered.length)}
        </p>
      )}
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
        <div
          ref={scroller}
          className="entrants-scroll"
          style={{ maxHeight: geometry.viewportHeight }}
          onScroll={virtual.onScroll}
        >
          <table
            aria-label={t("entrants.list.aria")}
            aria-rowcount={found.length + 1}
            className="entrants-table"
          >
            <thead>
              <tr>
                <th scope="col">{t("entrants.col.name")}</th>
                <th scope="col">{t("entrants.col.tickets")}</th>
                <th scope="col">{t("entrants.col.winner")}</th>
              </tr>
            </thead>
            <tbody>
              <Spacer rows={virtual.first} />
              {found.slice(virtual.first, virtual.end).map((row, offset) => (
                <EntrantRow key={row.entrant.seq} row={row} index={virtual.first + offset} />
              ))}
              <Spacer rows={found.length - virtual.end} />
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
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

function EntrantRow({ row, index }: { readonly row: ListedEntrant; readonly index: number }) {
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
        <span className="entrants-primary">{i18n.plural("ticket", entrant.tickets)}</span>
        <span className="entrants-secondary">{t(`group.${entrant.group}`)}</span>
      </Cell>
      <Cell>
        {winner === null ? null : (
          <>
            <span className="entrants-primary">{t("entrants.winner", { n: winner.n + 1 })}</span>
            <span className="entrants-secondary entrants-claim">
              {winner.claim.state === "waiting" ? (
                <ClaimClock until={winner.claimUntil} />
              ) : (
                <>
                  {claimIcon(winner)}
                  {claimLabel(winner, t)}
                </>
              )}
            </span>
          </>
        )}
      </Cell>
    </tr>
  )
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
