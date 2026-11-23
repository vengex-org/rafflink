import type { OperatorJson } from "@rafflink/core/http/json"
import type { ReactNode } from "react"
import { ExternalLink } from "../components/external-link.tsx"
import { Page } from "../components/page.tsx"
import { useStreamerSession } from "../components/streamer-session.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { useI18n, type I18n } from "../i18n/i18n.tsx"
import { repositoryUrl } from "../lib/links.ts"
import type { Load } from "../lib/use-load.ts"

/** One headed part of a legal text: paragraphs first, then a bullet list. */
interface Section {
  readonly heading: MessageKey
  readonly paragraphs: readonly MessageKey[]
  readonly items: readonly MessageKey[]
}

interface LegalDocument {
  readonly title: MessageKey
  readonly intro: MessageKey
  readonly sections: readonly Section[]
}

export function PrivacyPage() {
  return <LegalPage document={privacy} />
}

export function TermsPage() {
  return <LegalPage document={terms} />
}

// The other legal text is one click away in the footer every legal page ends with, so the page does not link it again.
function LegalPage({ document }: { readonly document: LegalDocument }) {
  const { t, rich, date, language } = useI18n()
  const { operator: load, reload } = useStreamerSession()
  const operator = load.state === "ready" ? load.value : null
  const placeholders: Readonly<Record<string, ReactNode>> = {
    operator: operator === null ? "" : operatorDetails(operator, t),
    contact: operator?.email ?? "",
    repository: (
      <ExternalLink kind="own" href={repositoryUrl}>
        {repositoryUrl}
      </ExternalLink>
    ),
  }
  return (
    <Page width="text" as="article" className="legal">
      <h1>{t(document.title)}</h1>
      {load.state === "ready" ? (
        <p className="legal-updated">
          {t("legal.updated", {
            date: date(Date.parse(`${operator?.legalUpdated ?? templateUpdated}T00:00`)),
          })}
        </p>
      ) : null}
      {language === "en" ? null : <p className="legal-translation">{t("legal.englishPrevails")}</p>}
      <p>{rich(document.intro, placeholders)}</p>
      {document.sections.map((section) => (
        <section key={section.heading}>
          <h2>{t(section.heading)}</h2>
          {section.paragraphs.map((key) => {
            const shown = paragraphFor(key, load)
            if (shown === null) return null
            return (
              <p key={key}>
                {rich(shown, placeholders)}
                {shown === "legal.unavailable" ? (
                  <button type="button" className="button" onClick={reload}>
                    {t("legal.retry")}
                  </button>
                ) : null}
              </p>
            )
          })}
          {section.items.length === 0 ? null : (
            <ul>
              {section.items.map((key) => (
                <li key={key}>{rich(key, placeholders)}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </Page>
  )
}

/** The day the template texts last changed, as an ISO date. Update it with every edit of the texts. */
const templateUpdated = "2026-11-23"

/** Paragraphs naming the operator or its contact, and what an instance without one shows in their place. */
const operatorTexts: Readonly<Partial<Record<MessageKey, MessageKey>>> = {
  "privacy.controller.p1": "privacy.controller.none",
  "terms.service.p1": "terms.service.none",
  "privacy.rights.p1": "privacy.rights.none",
  "terms.contact.p1": "terms.contact.none",
}

/** Where a failed session call says so; the other operator paragraphs stay hidden then. */
const unavailableKeys: ReadonlySet<MessageKey> = new Set([
  "privacy.controller.p1",
  "terms.service.p1",
])

/** Neither the operator text nor the "no operator" text shows until the session call has answered, and a failed call never claims either. */
function paragraphFor(key: MessageKey, operator: Load<OperatorJson | null>): MessageKey | null {
  const withoutOperator = operatorTexts[key]
  if (withoutOperator === undefined) return key
  switch (operator.state) {
    case "loading":
      return null
    case "failed":
      return unavailableKeys.has(key) ? "legal.unavailable" : null
    case "ready":
      return operator.value === null ? withoutOperator : key
  }
}

function operatorDetails(operator: OperatorJson, t: I18n["t"]): string {
  const parts = [operator.name]
  if (operator.id !== null) parts.push(t("legal.operator.id", { id: operator.id }))
  if (operator.address !== null) parts.push(operator.address)
  return parts.join(", ")
}

const privacy: LegalDocument = {
  title: "privacy.title",
  intro: "privacy.intro",
  sections: [
    {
      heading: "privacy.controller.h",
      paragraphs: ["privacy.controller.p1", "privacy.controller.p2"],
      items: [],
    },
    {
      heading: "privacy.data.h",
      paragraphs: ["privacy.data.p1"],
      items: [
        "privacy.data.i1",
        "privacy.data.i2",
        "privacy.data.i3",
        "privacy.data.i4",
        "privacy.data.i5",
        "privacy.data.i6",
        "privacy.data.i7",
        "privacy.data.i8",
        "privacy.data.i9",
        "privacy.data.i10",
        "privacy.data.i11",
      ],
    },
    {
      heading: "privacy.purposes.h",
      paragraphs: [],
      items: ["privacy.purposes.i1", "privacy.purposes.i2", "privacy.purposes.i3"],
    },
    {
      heading: "privacy.retention.h",
      paragraphs: [],
      items: [
        "privacy.retention.i1",
        "privacy.retention.i2",
        "privacy.retention.i3",
        "privacy.retention.i4",
        "privacy.retention.i5",
        "privacy.retention.i6",
        "privacy.retention.i7",
      ],
    },
    {
      heading: "privacy.recipients.h",
      paragraphs: ["privacy.recipients.p1"],
      items: [
        "privacy.recipients.i1",
        "privacy.recipients.i2",
        "privacy.recipients.i3",
        "privacy.recipients.i4",
        "privacy.recipients.i5",
        "privacy.recipients.i6",
      ],
    },
    {
      heading: "privacy.cookies.h",
      paragraphs: ["privacy.cookies.p1"],
      items: [
        "privacy.cookies.i1",
        "privacy.cookies.i2",
        "privacy.cookies.i3",
        "privacy.cookies.i4",
        "privacy.cookies.i5",
        "privacy.cookies.i6",
        "privacy.cookies.i7",
      ],
    },
    {
      heading: "privacy.rights.h",
      paragraphs: ["privacy.rights.p1", "privacy.rights.p2"],
      items: ["privacy.rights.i1", "privacy.rights.i2", "privacy.rights.i3", "privacy.rights.i4"],
    },
    {
      heading: "privacy.changes.h",
      paragraphs: ["privacy.changes.p1"],
      items: [],
    },
  ],
}

const terms: LegalDocument = {
  title: "terms.title",
  intro: "terms.intro",
  sections: [
    {
      heading: "terms.service.h",
      paragraphs: ["terms.service.p1", "terms.service.p2"],
      items: [],
    },
    {
      heading: "terms.source.h",
      paragraphs: ["terms.source.p1"],
      items: [],
    },
    {
      heading: "terms.streamers.h",
      paragraphs: ["terms.streamers.p1"],
      items: [
        "terms.streamers.i1",
        "terms.streamers.i2",
        "terms.streamers.i3",
        "terms.streamers.i4",
      ],
    },
    {
      heading: "terms.viewers.h",
      paragraphs: [],
      items: ["terms.viewers.i1", "terms.viewers.i2", "terms.viewers.i3"],
    },
    {
      heading: "terms.platforms.h",
      paragraphs: ["terms.platforms.p1"],
      items: [],
    },
    {
      heading: "terms.use.h",
      paragraphs: ["terms.use.p1"],
      items: ["terms.use.i1", "terms.use.i2", "terms.use.i3", "terms.use.i4"],
    },
    {
      heading: "terms.liability.h",
      paragraphs: ["terms.liability.p1", "terms.liability.p2"],
      items: [],
    },
    {
      heading: "terms.changes.h",
      paragraphs: ["terms.changes.p1"],
      items: [],
    },
    {
      heading: "terms.contact.h",
      paragraphs: ["terms.contact.p1"],
      items: [],
    },
  ],
}
