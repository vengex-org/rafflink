import type { ReactNode } from "react"
import { Page } from "../components/page.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { legalUpdated, operator } from "../lib/operator.ts"
import { repositoryUrl } from "../lib/links.ts"

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
  const { t, rich, date } = useI18n()
  const placeholders: Readonly<Record<string, ReactNode>> = {
    operatorName: operator.name,
    operatorAddress: operator.address,
    operatorId: operator.id,
    contactEmail: operator.contactEmail,
    repository: <a href={repositoryUrl}>{repositoryUrl}</a>,
  }
  return (
    <Page width="text" as="article" className="legal">
      <h1>{t(document.title)}</h1>
      <p className="legal-updated">
        {t("legal.updated", { date: date(Date.parse(`${legalUpdated}T00:00`)) })}
      </p>
      <p>{rich(document.intro, placeholders)}</p>
      {document.sections.map((section) => (
        <section key={section.heading}>
          <h2>{t(section.heading)}</h2>
          {section.paragraphs.map((key) => (
            <p key={key}>{rich(key, placeholders)}</p>
          ))}
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
      heading: "terms.twitch.h",
      paragraphs: ["terms.twitch.p1"],
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
