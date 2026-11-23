import type { Translation } from "./en.ts"

export const de: Translation = {
  "nav.main": "Hauptnavigation",
  "nav.skip": "Zum Inhalt springen",
  "nav.myGiveaways": "Meine Gewinnspiele",
  "nav.settings": "Einstellungen",
  "nav.admin": "Admin",
  "nav.selfHost": "Selbst hosten",
  "nav.verify": "Ziehung prüfen",
  "nav.github": "GitHub",
  "link.newTab": "Öffnet in einem neuen Tab",
  "nav.login": "Anmelden",
  "nav.logout": "Abmelden",
  "nav.streamerLogin": "Anmeldung für Streamer",
  "nav.support": "Rafflink unterstützen",
  "nav.loggedOut": "Abgemeldet.",
  "theme.legend": "Design",
  "theme.system": "System",
  "theme.light": "Hell",
  "theme.dark": "Dunkel",
  "language.legend": "Sprache",
  "language.loadFailed": "Diese Sprache konnte nicht geladen werden. Versuch es noch einmal.",
  "settings.label": "Anzeige-Einstellungen",

  "common.loading": "Lädt…",
  "common.cancel": "Abbrechen",
  "common.dismiss": "Schließen",
  "common.back": "Zurück",
  "common.next": "Weiter",
  "common.optional": "optional",
  "info.about": "Info: {topic}",
  "common.reloadPage": "Seite neu laden",
  "action.failed": "Etwas ist schiefgelaufen. Versuch es noch mal.",

  "failed.title": "Etwas ist schiefgelaufen",
  "failed.text": "Etwas ist schiefgelaufen. Lade die Seite neu.",
  "notFound.hint": "Prüf den Link und versuch es noch mal.",
  "notFound.home": "Zur Startseite",
  "notFound.page": "Seite nicht gefunden",
  "notFound.giveaway": "Gewinnspiel nicht gefunden",
  "notFound.live": "Live-Seite nicht gefunden",
  "notFound.generic": "Nicht gefunden",
  "notFound.history": "Dieser Streamer hat keinen öffentlichen Gewinnspielverlauf",

  "signIn.title": "Anmelden",
  "signIn.button": "Mit Twitch anmelden",
  "signIn.buttonKick": "Mit Kick anmelden",
  "signIn.buttonYouTube": "Mit YouTube anmelden",
  "signIn.why.admin": "Melde dich mit Twitch an, um die Admin-Seite zu öffnen.",
  "signIn.why.expired": "Deine Sitzung ist abgelaufen. Melde dich an, um weiterzumachen.",
  "signIn.why.live": "Melde dich an, um die Live-Seite deines Gewinnspiels zu öffnen.",

  "home.title": "Faire Gewinnspiele, live im Stream gezogen.",
  "home.text": "Zuschauer machen mit einem Klick mit, und du ziehst vor deinem Chat.",
  "home.login": "Anmelden und loslegen",
  "home.stage.toClaim": "zum Abholen",
  "home.reads": "Wir lesen nur deinen Namen und den Chat.",
  "home.worksWith": "Funktioniert mit",
  "home.trust.supportKoFi": "Auf Ko-fi unterstützen",
  "home.trust.support": "Rafflink unterstützen",
  "home.footer.guide": "Anleitung zum Selbsthosten",
  "home.footer.label": "Fußzeile",
  "home.problemTitle": "Anmeldung hat nicht geklappt",
  "home.problem.invalidState": "Die Anmeldung ist abgelaufen. Bitte versuch es noch mal.",
  "home.problem.noChannel":
    "Dieses Google-Konto hat keinen YouTube-Kanal. Melde dich mit dem Konto an, dem dein Kanal gehört.",
  "home.problem.tryAgain":
    "Die Streaming-Plattform hat nicht geantwortet. Bitte versuch es noch mal.",

  "oauthError.title": "Anmeldung mit {platform} fehlgeschlagen",
  "oauthError.access_denied": "Du hast die Anmeldung mit {platform} abgebrochen.",
  "oauthError.redirect_mismatch":
    "Diese Rafflink-Installation ist in den Entwicklereinstellungen von {platform} nicht richtig eingerichtet. Der Betreiber muss die Weiterleitungs-URLs hinzufügen.",
  "oauthError.setupLink": "Schritte zur App-Einrichtung bei {platform} ansehen",
  "oauthError.generic": "{platform} konnte dich nicht anmelden.",
  "oauthError.code": "Fehlercode: {code}",
  "oauthError.tryAgain": "Noch mal versuchen",
  "oauthError.dismiss": "Schließen",

  "admin.title": "Admin",
  "admin.only.title": "Nur für Admins",
  "admin.only.text": "Dieses Twitch-Konto ist kein Admin.",
  "admin.usage.title": "Nutzung heute",
  "admin.noLimit": "Dieser Server hat kein tägliches Anfragelimit.",
  "admin.unavailable": "Die heutige Nutzung ist gerade nicht verfügbar.",
  "admin.workerRequests": "Worker-Anfragen",
  "admin.doRequests": "Durable-Object-Anfragen",
  "admin.usageText": "{used} von {limit} Anfragen heute verbraucht",
  "admin.queue.title": "Warteschlange",
  "admin.queue.hint": "Teilnahmen warten hier, wenn sich viele Zuschauer gleichzeitig anmelden.",
  "admin.queue.waiting": "Teilnahmen warten",
  "admin.queue.rate": "Teilnahmen pro Sekunde durchgelassen",
  "admin.queue.dropped": "Teilnahmen verworfen",
  "admin.queue.abandoned": "Ergebnisse, die niemand abgeholt hat",
  "admin.queue.lostClaims": "Teilnahmen doppelt verarbeitet, ein Ergebnis verworfen",
  "admin.queue.cooldown": "Twitch-Sperre bis",
  "admin.queue.noCooldown": "keine",
  "admin.usageNoLimit": "{used} Anfragen heute, kein Tageslimit",
  "admin.alert.title": "Das heutige Limit ist bald erreicht",
  "admin.alert.workerRequests": "Worker-Anfragen liegen bei {percent} % des heutigen Limits.",
  "admin.alert.doRequests": "Durable-Object-Anfragen liegen bei {percent} % des heutigen Limits.",
  "admin.youtube.title": "YouTube-Kontingent",
  "admin.youtube.hint":
    "Jeder Aufruf der YouTube-API zählt gegen Googles Tageskontingent, das um Mitternacht pazifischer Zeit zurückgesetzt wird. Ist es aufgebraucht, lesen YouTube-Gewinnspiele den Chat nicht mehr.",
  "admin.youtube.units": "YouTube-Einheiten heute",
  "admin.youtube.usageText": "{used} von {limit} Einheiten heute verbraucht",
  "admin.youtube.alert":
    "Die YouTube-Einheiten von heute liegen bei {percent} % des Tageslimits. Beantrage bei Google mehr Kontingent, bevor YouTube-Gewinnspiele den Chat nicht mehr lesen.",
  "admin.alert.hint":
    "Wenn die Last weiter steigt, buch Workers Paid im Cloudflare-Dashboard und stell den Tarif unten auf Paid um.",
  "admin.plan.title": "Cloudflare-Tarif",
  "admin.plan.hint": "Buch zuerst Workers Paid im Cloudflare-Dashboard, dann stell um.",
  "admin.plan.link": "Cloudflare-Tarife",
  "admin.plan.free": "Free",
  "admin.plan.paid": "Paid",
  "admin.plan.paid.question": "Auf Paid umstellen?",
  "admin.plan.paid.detail":
    "Nur, wenn du Workers Paid schon bezahlt hast. Die App hebt dann die Tageslimits auf und die Warteschlange nimmt viel mehr Teilnahmen gleichzeitig an.",
  "admin.plan.paid.confirm": "Auf Paid umstellen",
  "admin.plan.free.question": "Zurück auf Free umstellen?",
  "admin.plan.free.detail":
    "Die App kehrt zu den Tageslimits von Free zurück und die Warteschlange nimmt nur wenige Teilnahmen gleichzeitig an.",
  "admin.plan.free.confirm": "Auf Free umstellen",
  "admin.plan.switched": "Tarif umgestellt.",
  "admin.plan.failed": "Der Tarif wurde nicht umgestellt. Versuch es noch mal.",
  "admin.plan.queueUnavailable":
    "Der Tarif ist gespeichert, aber die Warteschlange hat ihn noch nicht übernommen. Stell noch einmal um, um es erneut zu versuchen.",
  "admin.access.title": "Zugang für Streamer",
  "admin.access.hint":
    "Die Registrierung ist auf dieser Seite geschlossen. Streamer können sich anmelden, aber erst Gewinnspiele erstellen, wenn du sie freigibst.",
  "admin.access.pending": "Warten auf Freigabe",
  "admin.access.approved": "Freigegeben",
  "admin.access.nonePending": "Niemand wartet.",
  "admin.access.noneApproved": "Noch kein Streamer ist freigegeben.",
  "admin.access.truncated":
    "Es gibt mehr Streamer, als hier aufgelistet sind. Die neuesten werden angezeigt.",
  "admin.access.firstLogin": "Erste Anmeldung {date}",
  "admin.access.approve": "Freigeben",
  "admin.access.approve.label": "{name} freigeben",
  "admin.access.revoke": "Entziehen",
  "admin.access.revoke.label": "Freigabe von {name} entziehen",
  "admin.access.approvedDone": "Freigegeben.",
  "admin.access.revokedDone": "Freigabe entzogen.",
  "admin.access.failed":
    "Die Änderung ging nicht durch. Lade die Seite neu und versuch es noch mal.",
  "admin.access.loadFailed": "Die Streamer-Listen konnten nicht geladen werden.",
  "admin.limits.overridden": "in env gesetzt",
  "admin.limits.title": "Aktive Limits",
  "admin.limits.workerPerDay": "Worker-Anfragen pro Tag",
  "admin.limits.doPerDay": "Durable-Object-Anfragen pro Tag",
  "admin.limits.workerPerMonth": "Inklusive Worker-Anfragen pro Monat",
  "admin.limits.doPerMonth": "Inklusive Durable-Object-Anfragen pro Monat",
  "admin.limits.subrequests": "Subrequests pro Aufruf der Warteschlange",
  "admin.limits.none": "kein Tageslimit",
  "admin.live.updated": "Aktualisiert {time}",
  "admin.live.failed": "Die Live-Zahlen konnten nicht geladen werden. Neuer Versuch läuft.",
  "admin.live.title": "Gerade jetzt",
  "admin.live.openGiveaways": "offene Gewinnspiele",
  "admin.live.viewers": "verbundene Zuschauer",
  "admin.live.entriesMinute": "Teilnahmen in der letzten Minute",
  "admin.live.claimsMinute": "Abholungen in der letzten Minute",
  "admin.live.rateLimitedHour": "Twitch-429-Antworten in der letzten Stunde",
  "admin.live.partial":
    "Zuschauer, Teilnahmen und Abholungen beziehen sich auf die {shown} neuesten von {total} offenen Gewinnspielen.",
  "admin.presence.title": "Gerade auf der Seite",
  "admin.presence.hint":
    "Offene Tabs nach der Seite, die sie zeigen. OBS-Overlays und Live-Seiten zählen nicht.",
  "admin.presence.total": "Personen auf der Seite",
  "admin.presence.home": "Startseite",
  "admin.presence.legal": "Bedingungen und Datenschutz",
  "admin.presence.dashboard": "Dashboard und Admin",
  "admin.presence.giveaway": "Gewinnspielseiten",
  "admin.presence.other": "andere Seiten",
  "admin.presence.unavailable": "Die Zahl der Personen auf der Seite ist gerade nicht verfügbar.",
  "admin.giveaways.title": "Offene Gewinnspiele",
  "admin.giveaways.none": "Kein Gewinnspiel ist offen.",
  "admin.giveaways.streamer": "Streamer",
  "admin.giveaways.giveaway": "Gewinnspiel",
  "admin.giveaways.viewers": "Zuschauer",
  "admin.giveaways.entries": "Teilnahmen",
  "admin.giveaways.ends": "Endet",
  "admin.giveaways.noEnd": "wenn der Streamer es schließt",
  "admin.hour.title": "Letzte Stunde",
  "admin.hour.hint":
    "Teilnahmen und Abholungen pro Minute, gezählt von den Gewinnspielräumen. Eine Minute erscheint, sobald sie vorbei ist.",
  "admin.hour.entries": "Teilnahmen",
  "admin.hour.claims": "Abholungen",
  "admin.hour.rateLimited": "Twitch 429",
  "admin.hour.label":
    "{entries} Teilnahmen und {claims} Abholungen in der letzten Stunde, {rateLimited} Twitch-429-Antworten",
  "admin.hour.peak": "Spitze: {count} pro Minute",
  "admin.growth.title": "Wachstum",
  "admin.growth.hint": "Pro Tag (UTC) in den letzten {days} Tagen.",
  "admin.growth.giveaways": "Erstellte Gewinnspiele",
  "admin.growth.streamers": "Neue Streamer",
  "admin.growth.label":
    "{giveaways} Gewinnspiele und {streamers} neue Streamer in den letzten {days} Tagen",
  "admin.growth.returning":
    "Streamer mit einem zweiten Gewinnspiel innerhalb von {days} Tagen nach dem ersten",
  "admin.growth.pending": "Streamer warten auf Freigabe",
  "admin.growth.approved": "freigegebene Streamer",
  "admin.growth.atLeast": "{count}+",
  "admin.refs.title": "Woher Besucher kommen",
  "admin.refs.hint":
    "Besuche der Startseite mit ?ref=label in der Adresse in den letzten {days} Tagen. Kein Cookie, keine Adresse, nichts, was einen Besucher identifiziert.",
  "admin.refs.none": "Noch kein Besuch mit ref-Label.",
  "admin.refs.source": "Quelle",
  "admin.refs.visits": "Besuche",
  "admin.queue.rateLimited": "Twitch-429-Antworten",
  "admin.queue.lastRateLimited": "letztes Twitch 429",
  "admin.queue.never": "nie",

  "stat.people": "Teilnehmer",
  "stat.perSecond": "Teilnahmen pro Sekunde",
  "entrants.none": "Noch niemand macht mit.",
  "entrants.title": "Teilnehmer",
  "entrants.search.label": "Nach Name suchen",
  "entrants.search.help":
    "Tipp ein paar Buchstaben eines Namens oder Logins ein. Groß- und Kleinschreibung egal.",
  "entrants.col.name": "Name",
  "entrants.col.tickets": "Tickets",
  "entrants.col.status": "Status",
  "entrants.col.actions": "Aktionen",
  "entrants.winner": "Gewinner {n}",
  "entrants.list.aria": "Teilnehmer, scrollen für mehr",
  "entrants.loading.title": "Liste wird geladen",
  "entrants.loading.text": "Das dauert ein paar Sekunden, auch wenn viele mitgemacht haben.",
  "entrants.failed.title": "Die Liste wurde nicht geladen",
  "entrants.failed.text":
    "Rafflink konnte die Teilnehmerliste nicht laden. Dein Gewinnspiel ist davon nicht betroffen.",
  "entrants.retry": "Noch mal versuchen",
  "entrants.empty.title": "Die Liste ist leer",
  "entrants.empty.text": "Leute erscheinen hier, sobald sie mitmachen.",
  "entrants.noMatch.title": "Niemand passt zu deiner Suche",
  "entrants.noMatch.text": "Prüf die Schreibweise oder tipp weniger Buchstaben ein.",
  "entrants.clear": "Suche leeren",
  "entrants.search.placeholder": "Teilnehmer finden",
  "entrants.tiers": "Teilnehmer pro Gruppe",
  "entrants.showing": "{shown} von {total} angezeigt",
  "entrants.sort": "Gewinner zuerst, dann neueste",
  "entrants.status.claimed": "Abgeholt",
  "entrants.status.rerolled": "Neu gezogen",
  "entrants.status.expired": "Nicht abgeholt",
  "tier.viewer": "Zuschauer",
  "tier.follower": "Follower",
  "tier.sub_t1": "Tier 1",
  "tier.sub_t2": "Tier 2",
  "tier.sub_t3": "Tier 3",
  "tier.member": "Mitglied",
  "tier.vip": "VIP",
  "tier.moderator": "Mod",
  "overlay.enterAt": "Mitmachen auf",
  "overlay.qr": "QR-Code mit dem Link zum Gewinnspiel",
  "overlay.winners": "Gewinner",
  "overlay.moreWinners": "und {count} weitere",
  "giveaway.fallbackName": "Gewinnspiel {code}",

  "status.open": "Teilnahme offen",
  "status.closed": "Teilnahme beendet",
  "status.drawn": "Gewinner gezogen",
  "winner.removed": "(Teilnahme entfernt)",
  "claim.claimed.rafflink": "Auf Rafflink abgeholt",
  "claim.claimed.chat": "Im Chat abgeholt",
  "claim.claimed.manual": "Von Hand abgeholt",
  "claim.at": "{label} am {at}",
  "claim.waiting": "Wartet auf Abholung",
  "claim.expired": "Abholzeit abgelaufen",
  "claim.rerolled": "Nicht abgeholt, neu gezogen",
  "claim.tone.info": "übrig zum Abholen",
  "claim.tone.warning": "übrig, beeil dich",
  "claim.tone.danger": "übrig, jetzt abholen",

  "reason.broadcaster": "Der Streamer kann nicht an seinem eigenen Gewinnspiel teilnehmen.",
  "reason.subs-only": "Dieses Gewinnspiel ist nur für Abonnenten.",
  "reason.followers-only": "Dieses Gewinnspiel ist nur für Follower.",
  "reason.account-too-young": "Dein Twitch-Konto ist zu neu für dieses Gewinnspiel.",
  "reason.no-tickets": "Deine Gruppe bekommt in diesem Gewinnspiel keine Tickets.",
  "reason.page-entry-off": "Bei diesem Gewinnspiel machst du nur über den Stream-Chat mit.",
  "reasonHelp.page-entry-off":
    "Schreib das Stichwort von dieser Seite in den Stream-Chat, um mitzumachen.",
  "reasonHelp.broadcaster": "Melde dich mit einem anderen {platform}-Konto an, um mitzumachen.",
  "entry.otherAccount": "Anderes {platform}-Konto verwenden",
  "reason.blocked": "Du kannst an diesem Gewinnspiel nicht teilnehmen.",
  "reasonHelp.blocked": "Bei Fragen wende dich an den Streamer.",
  "reason.recent-winner":
    "Du hast eines der letzten Gewinnspiele dieses Streamers gewonnen, deshalb kannst du hier nicht mitmachen.",
  "reasonHelp.recent-winner":
    "Du kannst wieder mitmachen, sobald dein Gewinn nicht mehr zu den letzten Gewinnspielen zählt.",
  "reasonHelp.subs-only": "Abonniere den Kanal auf Twitch und öffne dann diesen Link noch einmal.",
  "reasonHelp.followers-only": "Folge dem Kanal auf Twitch und öffne dann diesen Link noch einmal.",
  "reasonHelp.account-too-young":
    "Komm wieder, wenn dein Konto älter ist. Mit einem anderen Konto mitzumachen hilft nicht.",
  "reasonHelp.no-tickets":
    "Der Streamer hat deiner Gruppe keine Tickets gegeben, du kannst hier also nicht gewinnen.",

  "group.viewer": "Zuschauer",
  "group.follower": "Follower",
  "group.sub_t1": "Abonnenten, Tier 1",
  "group.sub_t2": "Abonnenten, Tier 2",
  "group.sub_t3": "Abonnenten, Tier 3",
  "group.member": "Kanalmitglieder",
  "group.vip": "VIPs",
  "group.moderator": "Moderatoren",

  "viewerClaim.claimed": "Abgeholt! Der Streamer meldet sich bei dir.",
  "viewerClaim.already-claimed": "Dieser Preis wurde schon abgeholt.",
  "viewerClaim.expired": "Die Abholzeit ist abgelaufen.",
  "viewerClaim.rerolled": "Der Streamer hat einen anderen Gewinner gezogen.",
  "viewerClaim.not-a-winner": "Du hast bei diesem Gewinnspiel nicht gewonnen.",
  "viewerClaim.rejected":
    "Deine Abholung ging nicht durch. Melde dich neu an und drück auf Preis abholen.",

  "closeResult.closed": "Teilnahme beendet.",
  "closeResult.not-open": "Die Teilnahme war schon beendet.",
  "closeResult.rejected":
    "Teilnahme konnte nicht beendet werden. Lade die Seite neu und versuch es noch mal.",
  "drawResult.entries-deleted":
    "Die Teilnehmer wurden nach Ablauf der Aufbewahrungszeit schon gelöscht, deshalb können keine Gewinner mehr gezogen werden.",
  "drawResult.rejected": "Es konnte kein Gewinner gezogen werden.",
  "rerollResult.rerolled": "Ein anderer Gewinner wurde gezogen.",
  "rerollResult.already-rerolled": "Für diesen Platz wurde schon ein anderer Gewinner gezogen.",
  "rerollResult.already-claimed": "Dieser Gewinner hat schon abgeholt.",
  "rerollResult.unknown-pick": "Diesen Gewinner gibt es nicht.",
  "rerollResult.not-drawn": "Zieh zuerst die Gewinner.",
  "rerollResult.no-entrants-left": "Es sind keine Teilnehmer mehr zum Ziehen übrig.",
  "rerollResult.entries-deleted":
    "Die Teilnehmer wurden nach Ablauf der Aufbewahrungszeit schon gelöscht, deshalb kann kein anderer Gewinner gezogen werden.",
  "rerollResult.reroll-window-over":
    "Die Zeit zum Neuziehen ist vorbei. Kontaktier den Gewinner selbst oder starte ein neues Gewinnspiel.",
  "rerollResult.try-again": "Das hat nicht geklappt. Versuch es noch mal.",
  "rerollResult.rejected": "Es konnte kein anderer Gewinner gezogen werden.",
  "markResult.claimed": "Als abgeholt markiert.",
  "markResult.already-claimed": "Dieser Gewinner hat schon abgeholt.",
  "markResult.expired": "Die Abholzeit ist abgelaufen.",
  "markResult.rerolled": "Dieser Gewinner wurde durch einen anderen ersetzt.",
  "markResult.not-a-winner": "Diesen Gewinner gibt es nicht.",
  "markResult.rejected": "Die Abholung konnte nicht markiert werden.",

  "issue.not-an-object": "Ungültige Anfrage.",
  "issue.missing": "Dieses Feld ist erforderlich.",
  "issue.not-a-boolean": "Ungültiger Wert.",
  "issue.not-a-string": "Gib Text ein.",
  "issue.not-a-non-negative-integer": "Gib eine ganze Zahl ein, 0 oder mehr.",
  "issue.not-a-positive-integer": "Gib eine ganze Zahl ein, 1 oder mehr.",
  "issue.blank": "Dieses Feld darf nicht leer sein.",
  "issue.too-long": "Das ist zu lang. Kürz es.",
  "issue.too-large": "Diese Zahl ist zu groß. Gib eine kleinere ein.",
  "issue.no-entry-way":
    "Zuschauer brauchen einen Weg zum Mitmachen: die Seite, den Chat oder beides.",
  "issue.reconnect":
    "Verbinde Twitch zuerst neu: Für die Teilnahme per Abo und Kanalpunkten braucht Rafflink eine Berechtigung, die es noch nicht hat.",
  "issue.youtubeQuota":
    "Die YouTube-Einheiten von heute reichen nicht, um den Chat bis zum Ende der Teilnahme zu lesen. Beende die Teilnahme früher oder versuch es nach Mitternacht pazifischer Zeit noch einmal.",
  "issue.not-a-timestamp": "Gib ein gültiges Datum und eine gültige Uhrzeit ein.",
  "issue.in-the-past": "Das Ende muss in der Zukunft liegen.",
  "issue.unknown-kind": "Wähl eine der Optionen.",
  "issue.unsupported": "Deine Streaming-Plattform kann diese Regel nicht prüfen. Schalte sie aus.",
  "issue.not-a-list": "Ungültiger Wert.",
  "issue.duplicate": "Jede Option kann nur einmal gewählt werden.",
  "issue.wholeDays": "Gib eine ganze Zahl an Tagen ein oder lass das Feld leer.",
  "issue.wholeMinutes": "Gib eine ganze Zahl an Minuten ein, 1 oder mehr.",
  "issue.pickEnd": "Wähl Datum und Uhrzeit, wann die Teilnahme endet.",
  "issue.future": "Wähl eine Zeit in der Zukunft.",
  "issue.wholeYears": "Gib eine ganze Zahl an Jahren von 1 bis 99 ein oder lass das Feld leer.",

  "ticket.one": "{count} Ticket",
  "ticket.few": "{count} Tickets",
  "ticket.other": "{count} Tickets",
  "ticket.many": "{count} Tickets",
  "drawBatch.one": "{count} Gewinner ziehen",
  "drawBatch.few": "{count} Gewinner ziehen",
  "drawBatch.other": "{count} Gewinner ziehen",
  "drawBatch.many": "{count} Gewinner ziehen",
  "winners.one": "{count} Gewinner",
  "winners.few": "{count} Gewinner",
  "winners.other": "{count} Gewinner",
  "winners.many": "{count} Gewinner",
  "minute.one": "{count} Minute",
  "minute.few": "{count} Minuten",
  "minute.other": "{count} Minuten",
  "minute.many": "{count} Minuten",
  "day.one": "{count} Tag",
  "day.few": "{count} Tage",
  "day.other": "{count} Tage",
  "day.many": "{count} Tage",
  "year.one": "{count} Jahr",
  "year.few": "{count} Jahre",
  "year.other": "{count} Jahre",
  "year.many": "{count} Jahre",
  "recentGiveaways.one": "Gewinner des letzten Gewinnspiels von {name} können nicht mitmachen.",
  "recentGiveaways.few":
    "Gewinner der letzten {count} Gewinnspiele von {name} können nicht mitmachen.",
  "recentGiveaways.other":
    "Gewinner der letzten {count} Gewinnspiele von {name} können nicht mitmachen.",
  "recentGiveaways.many":
    "Gewinner der letzten {count} Gewinnspiele von {name} können nicht mitmachen.",
  "recentDays.one": "Gewinner aus Gewinnspielen von {name} vom letzten Tag können nicht mitmachen.",
  "recentDays.few":
    "Gewinner aus Gewinnspielen von {name} der letzten {count} Tage können nicht mitmachen.",
  "recentDays.other":
    "Gewinner aus Gewinnspielen von {name} der letzten {count} Tage können nicht mitmachen.",
  "recentDays.many":
    "Gewinner aus Gewinnspielen von {name} der letzten {count} Tage können nicht mitmachen.",
  "recentGiveawaysOwn.one": "Gewinner deines letzten Gewinnspiels können nicht mitmachen.",
  "recentGiveawaysOwn.few": "Gewinner deiner letzten {count} Gewinnspiele können nicht mitmachen.",
  "recentGiveawaysOwn.other":
    "Gewinner deiner letzten {count} Gewinnspiele können nicht mitmachen.",
  "recentGiveawaysOwn.many": "Gewinner deiner letzten {count} Gewinnspiele können nicht mitmachen.",
  "recentDaysOwn.one": "Gewinner deiner Gewinnspiele vom letzten Tag können nicht mitmachen.",
  "recentDaysOwn.few":
    "Gewinner deiner Gewinnspiele der letzten {count} Tage können nicht mitmachen.",
  "recentDaysOwn.other":
    "Gewinner deiner Gewinnspiele der letzten {count} Tage können nicht mitmachen.",
  "recentDaysOwn.many":
    "Gewinner deiner Gewinnspiele der letzten {count} Tage können nicht mitmachen.",
  "recentGiveawaysShort.one": "ohne Gewinner des letzten Gewinnspiels",
  "recentGiveawaysShort.few": "ohne Gewinner der letzten {count} Gewinnspiele",
  "recentGiveawaysShort.other": "ohne Gewinner der letzten {count} Gewinnspiele",
  "recentGiveawaysShort.many": "ohne Gewinner der letzten {count} Gewinnspiele",
  "recentDaysShort.one": "ohne Gewinner vom letzten Tag",
  "recentDaysShort.few": "ohne Gewinner der letzten {count} Tage",
  "recentDaysShort.other": "ohne Gewinner der letzten {count} Tage",
  "recentDaysShort.many": "ohne Gewinner der letzten {count} Tage",
  "entered.one": "{count} Person macht mit",
  "entered.few": "{count} Personen machen mit",
  "entered.other": "{count} Personen machen mit",
  "entered.many": "{count} Personen machen mit",
  "usageLow.one":
    "Achtung: Der Server hat heute nur noch {count} Anfrage übrig. Sind sie aufgebraucht, funktionieren Teilnahmen eventuell nicht mehr.",
  "usageLow.few":
    "Achtung: Der Server hat heute nur noch {count} Anfragen übrig. Sind sie aufgebraucht, funktionieren Teilnahmen eventuell nicht mehr.",
  "usageLow.other":
    "Achtung: Der Server hat heute nur noch {count} Anfragen übrig. Sind sie aufgebraucht, funktionieren Teilnahmen eventuell nicht mehr.",
  "usageLow.many":
    "Achtung: Der Server hat heute nur noch {count} Anfragen übrig. Sind sie aufgebraucht, funktionieren Teilnahmen eventuell nicht mehr.",
  "roleFailures.one":
    "Einmal konnte Rafflink deine VIP- und Moderatorenlisten nicht von Twitch laden. Diesen Zuschauern fehlen eventuell Extra-Tickets.",
  "roleFailures.few":
    "{count}-mal konnte Rafflink deine VIP- und Moderatorenlisten nicht von Twitch laden. Diesen Zuschauern fehlen eventuell Extra-Tickets.",
  "roleFailures.other":
    "{count}-mal konnte Rafflink deine VIP- und Moderatorenlisten nicht von Twitch laden. Diesen Zuschauern fehlen eventuell Extra-Tickets.",
  "roleFailures.many":
    "{count}-mal konnte Rafflink deine VIP- und Moderatorenlisten nicht von Twitch laden. Diesen Zuschauern fehlen eventuell Extra-Tickets.",
  "chatFailures.one":
    "Einmal hat Rafflink die Verbindung zu deinem Chat verloren. Die Chat-Überwachung hat eventuell Nachrichten verpasst.",
  "chatFailures.few":
    "{count}-mal hat Rafflink die Verbindung zu deinem Chat verloren. Die Chat-Überwachung hat eventuell Nachrichten verpasst.",
  "chatFailures.other":
    "{count}-mal hat Rafflink die Verbindung zu deinem Chat verloren. Die Chat-Überwachung hat eventuell Nachrichten verpasst.",
  "chatFailures.many":
    "{count}-mal hat Rafflink die Verbindung zu deinem Chat verloren. Die Chat-Überwachung hat eventuell Nachrichten verpasst.",

  "who.both": "Nur Abonnenten, die dem Kanal folgen, können mitmachen.",
  "who.subs": "Nur Abonnenten können mitmachen.",
  "who.followers": "Nur Follower können mitmachen.",
  "who.everyone": "Alle können mitmachen.",
  "who.ticketGroups": "Nur Gruppen, die Tickets bekommen, können mitmachen.",
  "whoShort.both": "Abonnenten, die folgen",
  "whoShort.subs": "Nur Abonnenten",
  "whoShort.followers": "Nur Follower",
  "whoShort.everyone": "Alle",
  "whoShort.ticketGroups": "Nur Gruppen mit Tickets",
  "extraTicketsShort.subs": "Abonnenten bekommen {tickets}",
  "extraTicketsShort.some": "Extra-Tickets für manche",
  "ticket.cannotEnter": "kann nicht mitmachen",
  "claimTime.clock": "{clock} Minuten",

  "step.of": "Schritt {current} von {total}: {name}",
  "step.allDone": "Alle {total} Schritte erledigt",
  "step.list": "Schritte",
  "step.go": "Schritt {number}: {name}",
  "winners.fewer": "Weniger Gewinner",
  "winners.more": "Mehr Gewinner",

  "giveaway.stepSignIn": "Anmelden",
  "giveaway.stepTicket": "Ticket holen",
  "giveaway.phase.open": "Teilnahme offen",
  "giveaway.phase.closed": "Teilnahme beendet",
  "giveaway.phase.drawn": "Gewinner gezogen",
  "giveaway.row.who": "Wer mitmachen kann",
  "giveaway.row.entries": "Teilnahmen",
  "giveaway.row.pool": "Gezogen aus",
  "giveaway.row.code": "Code",
  "giveaway.watch": "{name} auf Twitch ansehen",
  "giveaway.openUntilClosed": "Die Teilnahme bleibt offen, bis der Streamer sie beendet.",
  "giveaway.aboutToClose": "Die Teilnahme endet gleich.",
  "giveaway.closesIn": "Die Teilnahme endet in {time}.",
  "giveaway.drawn.title": "Die Gewinner sind gezogen",
  "giveaway.drawn.text": "Melde dich mit {platform} an, um zu sehen, ob du gewonnen hast.",
  "giveaway.notThisTime.title": "Diesmal nicht",
  "giveaway.notThisTime.text": "Der Gewinner wurde gezogen. Diesmal warst du es nicht.",
  "giveaway.ready.title": "Bereit mitzumachen?",
  "giveaway.ready.text":
    "Melde dich mit deinem {platform}-Konto an, um dein Ticket zu holen. Das dauert nur ein paar Sekunden.",
  "giveaway.enter": "Mit Twitch mitmachen",
  "giveaway.enterKick": "Mit Kick mitmachen",
  "giveaway.signedOut.title": "Zum Mitmachen anmelden",
  "giveaway.waiting.title": "Warten auf die Ziehung",
  "giveaway.waiting.text":
    "Die Teilnahme ist beendet. Der Streamer zieht den Gewinner live. Lass diese Seite offen: Wenn du gewinnst, wechselt sie von selbst zur Abholung.",
  "giveaway.paused.title": "Teilnahme pausiert",
  "giveaway.paused.text":
    "{platform}-Gewinnspiele sind auf dieser Seite vorerst pausiert. Schau später wieder vorbei.",
  "giveaway.closed.title": "Sorry, Gewinnspiel beendet.",
  "giveaway.closed.text":
    "Der Streamer nimmt keine Teilnahmen mehr an. Folge dem Kanal, um das nächste nicht zu verpassen.",
  "entry.in.title": "Du bist dabei",
  "entry.in.detail":
    "Der Streamer zieht den Gewinner live. Lass diese Seite offen oder komm später wieder.",
  "entry.in.help": "Viel Glück!",
  "entry.already.detail":
    "Deine erste Teilnahme bleibt bestehen. Du musst nicht noch mal mitmachen.",
  "entry.already.help":
    "Der Streamer zieht den Gewinner live. Lass diese Seite offen oder komm später wieder.",
  "entry.in.tickets": "Deine Teilnahme: {tickets} {role}.",
  "entry.role.viewer": "als Zuschauer",
  "entry.role.follower": "als Follower",
  "entry.role.sub_t1": "als Tier-1-Abonnent",
  "entry.role.sub_t2": "als Tier-2-Abonnent",
  "entry.role.sub_t3": "als Tier-3-Abonnent",
  "entry.role.member": "als Kanalmitglied",
  "entry.role.vip": "als VIP",
  "entry.role.moderator": "als Moderator",
  "entry.pending.title": "Du wirst eingetragen",
  "entry.pending.detail": "Das dauert bis zu {wait}. Schließ diese Seite nicht.",
  "entry.pending.help": "{platform} ist ausgelastet. Diese Seite aktualisiert sich von selbst.",
  "entry.notEligible.title": "Du kannst nicht mitmachen",
  "entry.dropped.title": "Deine Teilnahme hat zu lange gedauert",
  "entry.dropped.detail":
    "Zu viele Leute wollten gleichzeitig mitmachen und deine Teilnahme wurde verworfen.",
  "entry.dropped.help": "Drück den Button, um noch mal mitzumachen.",
  "entry.timedOut.title": "Das dauert zu lange",
  "entry.timedOut.detail": "Wir haben nicht rechtzeitig eine Antwort bekommen.",
  "entry.timedOut.help": "Drück den Button, um noch mal mitzumachen.",
  "entry.tryAgain.title": "Noch mal versuchen",
  "entry.tryAgain.detail": "{platform} hat nicht rechtzeitig geantwortet.",
  "entry.tryAgain.help": "Drück den Button für einen neuen Versuch.",
  "entry.rateLimited.title": "Zu viele Versuche",
  "entry.rateLimited.detail": "Du hast in kurzer Zeit zu oft versucht mitzumachen.",
  "entry.rateLimited.help":
    "Warte eine Minute und drück dann den Button, um es noch mal zu versuchen.",
  "entry.invalidState.title": "Anmeldung abgelaufen",
  "entry.invalidState.detail": "Deine Anmeldung hat zu lange gedauert.",
  "entry.invalidState.help": "Drück den Button, um neu zu starten.",
  "win.another.title": "Ein anderer Gewinner wurde gezogen",
  "win.title": "Du hast gewonnen",
  "win.claimed.title": "Preis abgeholt",
  "win.claimedAt": "Abgeholt am {at}. {name} meldet sich bei dir.",
  "win.contact": "{name} meldet sich bei dir.",
  "win.up.title": "Zeit abgelaufen",
  "win.up.text": "Der Streamer kann einen anderen Gewinner ziehen.",
  "win.press":
    "Hol ihn jetzt ab, sonst kann der Streamer nach Ablauf des Timers jemand anderen ziehen.",
  "win.claim": "Preis abholen",
  "win.orAny": "Oder schreib irgendeine Nachricht in den Stream-Chat.",
  "win.orType": "Oder schreib {keyword} in den Stream-Chat.",

  "winnerField.name": "Name",
  "winnerField.email": "E-Mail",
  "winnerField.address": "Lieferadresse",
  "winnerField.platform-id": "Spielkonto oder Plattform-ID",
  "winnerField.text": "Nachricht an den Streamer",
  "winnerForm.title": "Wohin soll der Preis gehen?",
  "winnerForm.notice": "Nur {name} sieht das. Nach der Lieferung gelöscht (max. 30 Tage).",
  "winnerForm.send": "Senden",
  "winnerForm.saved": "Deine Antworten wurden an den Streamer gesendet.",
  "winnerForm.already-answered": "Du hast deine Antworten schon gesendet.",
  "winnerForm.not-claimed": "Hol zuerst den Preis ab.",
  "winnerForm.form-closed": "Das Formular ist geschlossen.",
  "winnerForm.not-a-winner": "Du hast bei diesem Gewinnspiel nicht gewonnen.",
  "winnerForm.rejected": "Senden hat nicht geklappt. Versuch es noch mal.",
  "winnerForm.invalid": "Füll jedes Feld aus. Die E-Mail braucht ein @.",
  "answers.title": "Antworten der Gewinner",
  "answers.none": "Noch kein Gewinner hat abgeholt.",
  "answers.pick": "Gewinner {n}: {name}",
  "answers.unnamed": "unbekannter Gewinner",
  "answers.waiting": "Noch nicht gesendet.",
  "answers.deleted": "Die Antworten wurden gelöscht.",
  "answers.received": "Antworten erhalten.",
  "answers.show": "Antworten zeigen",
  "answers.hide": "Antworten ausblenden",
  "answers.confirm.title": "Private Antworten zeigen?",
  "answers.confirm.text": "Achte darauf, dass diese Seite nicht in deinem Stream zu sehen ist.",
  "answers.confirm.show": "Zeigen",
  "answers.closed": "Nicht gesendet. Das Formular ist geschlossen.",
  "answers.delivered": "Geliefert am {at}.",
  "answers.markDelivered": "Als geliefert markieren",
  "answers.deliverFailed":
    "Der Preis konnte nicht als geliefert markiert werden. Lade die Seite neu.",
  "answers.failed": "Die Antworten konnten nicht geladen werden.",
  "answers.privacy": "Nur du siehst sie. Gelöscht bei Lieferung oder nach 30 Tagen.",
  "rules.summary": "Regeln und Tickets",
  "rules.help": "Je mehr Tickets eine Gruppe bekommt, desto besser ihre Gewinnchance.",
  "rules.groupTickets": "{group}: {tickets}",
  "rules.accountAge": "Konto mindestens {days} alt",
  "rules.entriesEnd": "Die Teilnahme endet {time} oder früher, wenn {name} sie beendet.",
  "rules.claimTime": "Gewinner haben {time} Zeit zum Abholen.",
  "rules.claimWhere": "Ein Gewinner holt den Preis auf dieser Seite oder im Stream-Chat ab.",
  "rules.organizer": "Veranstaltet von {name}. Rafflink ist nicht der Veranstalter.",
  "rules.blocked": "Konten, die {name} blockiert hat, können nicht mitmachen.",
  "rules.broadcaster": "{name} kann nicht am eigenen Gewinnspiel teilnehmen.",
  "rules.platform":
    "{platform} sponsert, unterstützt oder veranstaltet dieses Gewinnspiel nicht und steht in keiner Verbindung dazu.",
  "rules.prize": "Preis: {prize}",
  "rules.prizeNone": "Der Preis ist hier nicht beschrieben. Frag {name}.",
  "rules.enterPage": "Zum Mitmachen melde dich auf dieser Seite mit {platform} an.",
  "rules.enterChat":
    "Zum Mitmachen schreib „{keyword}“ im {platform}-Chat von {name}, solange die Teilnahme offen ist.",
  "rules.enterSub":
    "Wer {name} abonniert, sein Abo verlängert oder ein Geschenk-Abo bekommt, solange die Teilnahme offen ist, macht ebenfalls mit. Du musst nie abonnieren, um mitzumachen.",
  "rules.enterPoints":
    "Wer die Kanalpunkte-Belohnung „{reward}“ einlöst, solange die Teilnahme offen ist, macht ebenfalls einmal mit, ohne Extra-Tickets.",
  "rules.free":
    "Die Teilnahme ist kostenlos. Du musst nichts kaufen, um mitzumachen oder zu gewinnen.",
  "rules.paidOnly":
    "Nur Abonnenten können mitmachen, es gibt also keinen kostenlosen Weg, an diesem Gewinnspiel teilzunehmen.",
  "rules.minAge": "Gewinner müssen mindestens {age} alt sein.",
  "rules.excludedCountries": "Wer an diesen Orten wohnt, kann nicht gewinnen: {places}.",
  "rules.checkedByStreamer":
    "Rafflink kann Alter und Wohnort nicht prüfen. {name} kann das prüfen und den Preis zurückhalten.",
  "rules.entriesEndManual": "Die Teilnahme endet, wenn {name} sie beendet.",
  "rules.draw":
    "Die Gewinner werden zufällig gezogen, gewichtet nach Tickets, aus einer öffentlichen Zufallszahl (drand), die hier niemand kontrolliert.",
  "rules.verify": "Jeder kann die Ziehung prüfen unter {url}",
  "rules.claimLate":
    "Bis der Gewinner den Preis abholt, kann {name} ihn durch eine neue Ziehung ersetzen.",
  "rules.delivery": "{name} übergibt den Preis. Rafflink verwahrt und verschickt keine Preise.",
  "rules.winnerForm":
    "Nach der Abholung füllt der Gewinner auf dieser Seite ein kurzes Formular für die Lieferung aus ({fields}). Nur {name} sieht die Antworten. Sie werden gelöscht, wenn der Preis geliefert ist, spätestens 30 Tage nach der Abholung.",
  "rules.extraTerms": "Weitere Bedingungen von {name}:",
  "rules.notice":
    "Diese Regeln werden aus den Einstellungen des Gewinnspiels erstellt. Sie sind eine Vorlage, keine Rechtsberatung.",
  "rules.copy": "Regeln als Text kopieren",
  "rules.copyHeading": "Regeln des Gewinnspiels: {url}",

  "dash.title": "Meine Gewinnspiele",
  "dash.settings.title": "Einstellungen",
  "dash.new.title": "Neues Gewinnspiel",
  "dash.new.button": "Neues Gewinnspiel",
  "dash.created.title": "Dein Gewinnspiel ist live!",
  "dash.roomNotReady":
    "Das Gewinnspiel ist noch nicht ganz bereit. Öffne die Live-Seite, um die Einrichtung abzuschließen.",
  "dash.next": "Teil diesen Link in deinem Chat.",
  "dash.openLive": "Live-Seite öffnen",
  "dash.obs.title": "Zu OBS hinzufügen (optional)",
  "dash.obs.text": "Zeig die Teilnahmen im Stream, während Leute mitmachen.",
  "dash.obs.steps": "So fügst du es in OBS hinzu",
  "dash.back": "Zurück zu meinen Gewinnspielen",
  "dash.access.title": "Warten auf Freigabe",
  "dash.access.text":
    "Du bist angemeldet, aber der Admin dieser Seite hat dein Konto noch nicht zum Erstellen von Gewinnspielen freigegeben. Frag den Admin und lade dann diese Seite neu.",
  "dash.support.text": "Wenn dir Rafflink Zeit gespart hat, kannst du es unterstützen.",
  "dash.support.link": "Unterstützen",
  "dash.empty.title": "Erstelle dein erstes Gewinnspiel",
  "dash.empty.text": "Das dauert etwa eine Minute. So funktioniert es.",
  "dash.empty.create.lead": "Erstellen.",
  "dash.empty.create.rest": "Sag, was du verlost und wer mitmachen kann.",
  "dash.empty.share.lead": "Link teilen.",
  "dash.empty.share.rest":
    "Füg ihn in deinen Chat ein. Zuschauer melden sich auf der Gewinnspielseite an, um mitzumachen.",
  "dash.empty.draw.lead": "Live ziehen.",
  "dash.empty.draw.rest": "Beende die Teilnahme und zieh den Gewinner in deinem Stream.",
  "dash.empty.button": "Gewinnspiel erstellen",
  "dash.prize": "Preis: {prize}",
  "dash.codeCreated": "Code {code}, erstellt {date}",
  "dash.delivered": "{delivered} von {claimed} geliefert",
  "dash.linkObs": "Link und OBS-Overlay",
  "dash.duplicate": "Duplizieren",
  "dash.duplicate.label": "{name} duplizieren",
  "dash.section.running": "Laufend",
  "dash.section.drawn": "Beendet",
  "dash.search.label": "Beendete Gewinnspiele durchsuchen",
  "dash.search.placeholder": "Nach Name, Preis oder Code suchen",
  "dash.search.none": "Kein beendetes Gewinnspiel passt zu deiner Suche.",
  "dash.csv": "Gewinner als CSV",
  "dash.csv.label": "Gewinner als CSV, {name}",
  "dash.delete": "Löschen",
  "dash.delete.question": "{name} löschen?",
  "dash.delete.detail":
    "Das Gewinnspiel wird mit Teilnehmern, Gewinnern und Ziehungsnachweis endgültig gelöscht, und sein Link funktioniert nicht mehr.",
  "dash.delete.confirm": "Ja, löschen",
  "dash.deleteData.title": "Deine Daten",
  "dash.deleteData.text":
    "Du kannst alle Gewinnspiele, die du erstellt hast, zusammen mit deinem Rafflink-Konto löschen.",
  "dash.deleteData.button": "Alle meine Daten löschen",
  "dash.deleteData.question": "Alle deine Daten löschen?",
  "dash.deleteData.detail":
    "Alle Gewinnspiele mit Teilnehmern, Gewinnern und Ziehungsnachweis, dein Konto und dein gespeichertes Anmeldetoken werden endgültig gelöscht, und du wirst abgemeldet.",
  "dash.deleteData.confirm": "Ja, alles löschen",
  "dash.blocks.title": "Blockierte Konten",
  "dash.blocks.text": "Blockierte Konten können an deinen Gewinnspielen nicht teilnehmen.",
  "dash.blocks.info":
    "Ihre Teilnahmen an offenen Gewinnspielen werden entfernt; Teilnahmen an beendeten Gewinnspielen bleiben. Die Liste wird mit deinem Konto gelöscht.",
  "dash.blocks.count": "{count} von {max} Konten blockiert",
  "dash.blocks.none": "Keine Konten blockiert.",
  "dash.blocks.label": "Benutzername zum Blockieren",
  "dash.blocks.add": "Blockieren",
  "dash.blocks.remove": "Entfernen",
  "dash.blocks.remove.label": "{login} von der Blockliste entfernen",
  "dash.blocks.since": "blockiert {date}",
  "dash.blocks.added": "Konto blockiert.",
  "dash.blocks.exists": "Dieses Konto ist schon blockiert.",
  "dash.blocks.removed": "Konto von der Blockliste entfernt.",
  "dash.blocks.invalid-input": "Gib einen Benutzernamen ein.",
  "dash.blocks.unknown-login": "Es gibt kein Konto mit diesem Benutzernamen.",
  "dash.blocks.block-list-full": "Die Blockliste ist voll. Entferne zuerst ein Konto.",
  "dash.blocks.platform-unavailable":
    "Die Streaming-Plattform hat nicht geantwortet. Versuch es gleich noch mal.",
  "dash.blocks.room-unavailable":
    "Gespeichert, aber ein laufendes Gewinnspiel hat die Änderung noch nicht übernommen. Führ dieselbe Aktion noch mal aus.",
  "dash.history.title": "Öffentlicher Verlauf",
  "dash.history.text":
    "Zeig deine beendeten Gewinnspiele auf einer öffentlichen Seite. Ohne Namen von Teilnehmern.",
  "dash.history.link": "Deine öffentliche Verlaufsseite öffnen",
  "dash.history.turnOn": "Öffentlichen Verlauf einschalten",
  "dash.history.turnOff": "Öffentlichen Verlauf ausschalten",
  "dash.history.saved":
    "Gespeichert. Die öffentliche Seite kann ein paar Minuten brauchen, bis sie die Änderung zeigt.",
  "dash.history.notIndexed": "Suchmaschinen indexieren die Seite nicht.",
  "dash.history.indexed":
    "Suchmaschinen dürfen die Seite indexieren und in ihren Ergebnissen zeigen.",
  "dash.history.allowIndexing": "Indexierung durch Suchmaschinen erlauben",
  "dash.history.stopIndexing": "Indexierung durch Suchmaschinen stoppen",
  "dash.history.hide": "Im Verlauf ausblenden",
  "dash.history.show": "Im Verlauf zeigen",
  "dash.history.hide.label": "{name} in deinem öffentlichen Verlauf ausblenden",
  "dash.history.show.label": "{name} in deinem öffentlichen Verlauf zeigen",
  "history.title": "Gewinnspiele von {name}",
  "history.intro":
    "Beendete Gewinnspiele dieses Streamers, neueste zuerst. Jede Ziehung kann auf ihrer Prüfseite kontrolliert werden. Hier werden keine Teilnehmer und keine Gewinner genannt.",
  "history.none": "Noch keine beendeten Gewinnspiele.",
  "history.closed": "Teilnahme beendet {date}",
  "history.verify": "Ziehung prüfen",
  "history.verify.label": "Ziehung von {name} prüfen",

  "share.link": "Dein Link",
  "share.copyLink": "Link kopieren",
  "share.overlay": "Overlay-Link",
  "share.copyOverlay": "Overlay-Link kopieren",
  "share.obs.1": "Such in OBS das Feld Quellen und drück den Button +.",
  "share.obs.2": "Wähl Browser und drück OK.",
  "share.obs.3": "Füg den Overlay-Link in das Feld URL ein.",
  "share.obs.4": "Stell Breite auf 800 und Höhe auf 600 und drück dann OK.",
  "copy.copied": "Kopiert!",
  "copy.failed": "Kopieren fehlgeschlagen. Der Text ist markiert: drück Strg+C.",

  "live.reconnecting": "Verbindung zum Live-Feed wird wiederhergestellt…",
  "live.chatOff.title": "Chat-Überwachung ist aus",
  "live.chatEntryOff.text":
    "Teilnahme per Chat ist aus: Rafflink kann deinen Chat gerade nicht lesen, das Stichwort trägt also niemanden ein. Zuschauer können weiter auf der Gewinnspielseite mitmachen, wenn sie Teilnahmen über die Seite annimmt.",
  "live.channelEntryOff.text":
    "Teilnahme per Abo und Kanalpunkten ist aus: Rafflink kann diese Twitch-Ereignisse gerade nicht lesen, oft weil eine Berechtigung entfernt wurde. Der kostenlose Weg zum Mitmachen ist nicht betroffen. Verbinde Twitch vor deinem nächsten Gewinnspiel neu.",
  "live.subEntryOff.text":
    "Teilnahme per Abo ist aus: Rafflink kann neue Abos gerade nicht lesen, oft weil eine Berechtigung entfernt wurde, ein Abo trägt also niemanden ein. Andere Wege zum Mitmachen sind nicht betroffen. Verbinde dein Konto vor deinem nächsten Gewinnspiel neu.",
  "live.pointsEntryOff.text":
    "Teilnahme per Kanalpunkten ist aus: Rafflink kann Einlösungen der Belohnung gerade nicht lesen, oft weil eine Berechtigung entfernt wurde, eine Einlösung trägt also niemanden ein. Andere Wege zum Mitmachen sind nicht betroffen. Verbinde dein Konto vor deinem nächsten Gewinnspiel neu.",
  "live.entryWayOff.title": "Teilnahme ist teilweise aus",
  "live.chatOff.text":
    "Abholung per Chat nicht verfügbar: Rafflink kann deinen Chat gerade nicht lesen, Gewinner können also nicht durch Schreiben im Chat abholen. Wenn dir ein Gewinner sagt, dass er da ist, drück neben seinem Namen auf Als abgeholt markieren.",
  "live.closesAt": "Die Teilnahme endet von selbst um {time}.",
  "live.close.label": "Teilnahme beenden",
  "live.close.question": "Teilnahme jetzt beenden?",
  "live.close.detail":
    "Danach kann niemand Neues mehr mitmachen. Das lässt sich nicht rückgängig machen.",
  "live.close.confirm": "Ja, Teilnahme beenden",
  "live.share.title": "Mit deinem Chat teilen",
  "live.overlay.title": "Im Stream zeigen",
  "live.overlay.mode": "Was gezeigt wird",
  "live.overlay.mode.auto": "Automatisch",
  "live.overlay.mode.auto.help":
    "Teilnahmelink und Anzahl, während Leute mitmachen, dann die Gewinner.",
  "live.overlay.mode.compact": "Eckabzeichen",
  "live.overlay.mode.compact.help":
    "Teilnahmelink, Anzahl und neueste Namen, dann eine kleine Zeile mit den Gewinnern.",
  "live.overlay.mode.winner": "Nur Gewinner",
  "live.overlay.mode.winner.help": "Leer bis zur Ziehung, dann nur die Gewinner.",
  "live.overlay.qr": "QR-Code",
  "live.overlay.qr.help":
    "Zuschauer am Fernseher oder an der Konsole können den Link nicht anklicken.",
  "live.overlay.qr.on": "Zeigen",
  "live.overlay.qr.off": "Ausblenden",
  "overlayStyle.dash.summary": "Overlay-Stil",
  "overlayStyle.dash.help":
    "So sieht dein OBS-Overlay aus. Ein Gewinnspiel kann auf seiner Live-Seite einen eigenen Stil bekommen.",
  "overlayStyle.giveaway.summary": "Stil dieses Overlays",
  "overlayStyle.giveaway.source": "Stil",
  "overlayStyle.giveaway.streamer": "Mein Stil",
  "overlayStyle.giveaway.streamer.help": "Der Stil aus deinem Dashboard.",
  "overlayStyle.giveaway.own": "Nur dieses Gewinnspiel",
  "overlayStyle.giveaway.own.help": "Dein Dashboard-Stil bleibt, wie er ist.",
  "overlayStyle.accent": "Akzent",
  "overlayStyle.background": "Flächen",
  "overlayStyle.text": "Text",
  "overlayStyle.font": "Schrift",
  "overlayStyle.size": "Größe",
  "overlayStyle.size.small": "Klein",
  "overlayStyle.size.medium": "Mittel",
  "overlayStyle.size.large": "Groß",
  "overlayStyle.position": "Ecke",
  "overlayStyle.position.top-left": "Oben links",
  "overlayStyle.position.top-right": "Oben rechts",
  "overlayStyle.position.bottom-left": "Unten links",
  "overlayStyle.position.bottom-right": "Unten rechts",
  "overlayStyle.corners": "Ecken der Flächen",
  "overlayStyle.corners.rounded": "Abgerundet",
  "overlayStyle.corners.square": "Eckig",
  "overlayStyle.sound": "Sound, wenn ein Gewinner erscheint",
  "overlayStyle.sound.help":
    "Aktiviere in der Browserquelle „Audio über OBS steuern“, damit er im Stream zu hören ist.",
  "overlayStyle.confetti": "Konfetti, wenn ein Gewinner erscheint",
  "overlayStyle.confetti.help": "Entfällt, wenn der Computer reduzierte Bewegung verlangt.",
  "overlayStyle.on": "An",
  "overlayStyle.off": "Aus",
  "overlayStyle.preview": "Vorschau",
  "overlayStyle.preview.prize": "Ein Gaming-Stuhl",
  "overlayStyle.lowContrast":
    "Der Text ist auf diesen Flächen schwer lesbar. Wähl eine hellere oder dunklere Textfarbe.",
  "overlayStyle.save": "Stil speichern",
  "overlayStyle.reset": "Auf Standard zurücksetzen",
  "overlayStyle.saved": "Gespeichert. OBS zeigt den neuen Stil sofort.",
  "overlayStyle.rejected":
    "Der Stil wurde nicht gespeichert. Lade die Seite neu und versuch es noch mal.",
  "live.draw.title": "Teilnahme ist beendet",
  "live.draw.text": "{people}. Zieh den Gewinner, wenn du bereit bist.",
  "live.draw.count": "Geplante Gewinner",
  "live.draw.batchCount": "Gewinner auf einmal",
  "live.draw.batchInvalid": "Wähl 1 bis {most}",
  "live.draw.nobody": "Niemand hat mitgemacht, es gibt also niemanden zum Ziehen.",
  "live.draw.random": "Der Gewinner wird zufällig aus allen Teilnehmern gezogen.",
  "live.draw.label": "Gewinner ziehen",
  "drawResult.requested":
    "Die Teilnahme ist beendet. Der Gewinner wird von selbst gezogen, sobald die Zufallszahl bereit ist.",
  "drawResult.not-open":
    "Das Gewinnspiel hat sich geändert, während du auf Gewinner ziehen gedrückt hast. Drück noch mal.",
  "drawResult.no-entrants-left": "Alle Teilnehmer wurden schon gezogen.",
  "drawResult.pick-limit":
    "So viele weitere Gewinner passen nicht in dieses Gewinnspiel. Zieh weniger oder keine, wenn es voll ist.",
  "drawResult.try-again":
    "Gleichzeitig lief eine andere Ziehung. Drück noch mal auf Gewinner ziehen.",
  "live.draw.next": "Nächsten Gewinner ziehen",
  "live.draw.question": "Teilnahme beenden und Gewinner ziehen?",
  "live.draw.due": "Gewinner wird gezogen…",
  "live.draw.nobodyLeft": "Alle Teilnehmer wurden gezogen.",
  "live.draw.detail":
    "Die Teilnahme endet endgültig. Der Gewinner wird gleich gezogen, auch wenn du diese Seite schließt.",
  "live.draw.confirm": "Ja, beenden und ziehen",
  "live.draw.waiting":
    "Warten auf die öffentliche Zufallszahl (drand). Der Gewinner wird in {clock} von selbst gezogen.",
  "live.winners.title": "Gewinner",
  "live.winners.pageOrChat":
    "Jeder Gewinner hat begrenzt Zeit, den Preis abzuholen. Er holt ihn auf der Gewinnspielseite oder durch Schreiben in deinem Chat ab.",
  "live.winnerFallback": "Gewinner {n}",
  "live.mark.label": "Als abgeholt markieren",
  "live.mark.aria": "Für {name} als abgeholt markieren",
  "live.reroll.over":
    "Die Zeit zum Neuziehen ist vorbei. Kontaktier die Gewinner, die nicht abgeholt haben, oder starte ein neues Gewinnspiel.",
  "live.reroll.question": "Anderen Gewinner statt {name} ziehen?",
  "live.reroll.detail": "{name} verliert den Preis. Das lässt sich nicht rückgängig machen.",
  "live.reroll.confirm": "Ja, neu ziehen",
  "live.problems.title": "Probleme",
  "live.bar.label": "Gewinnspiel-Steuerung",
  "live.settings.title": "Gewinnspiel-Einstellungen",
  "live.stats.title": "Statistik",
  "live.side.label": "Statistik und Einstellungen",
  "live.bar.waiting": "Warten, bis {name} den Preis abholt.",
  "live.bar.claimed": "{name} hat den Preis abgeholt.",
  "live.bar.unclaimed": "Noch niemand hat den Preis abgeholt.",
  "live.clean.hide": "Steuerung ausblenden",
  "live.clean.show": "Steuerung zeigen",
  "live.support": "Unterstützen",
  "live.chat.title": "Chat",
  "live.chat.hint": "Die Chatnachrichten des Gewinners erscheinen hier.",
  "live.chat.hint.settled": "Wenn der Gewinner im Chat schreibt, siehst du es hier.",
  "live.chip": "LIVE",
  "live.gives": "{streamer} verlost {prize}",
  "live.winnerOf": "Gewinner {n} von {total}",
  "live.pickedFrom": "Gezogen aus {tickets}",
  "live.progress": "Gezogene Gewinner",
  "live.winnerSub": "{tier}-Abo",
  "live.claimHint.anyChat":
    "{name}, schreib irgendwas in den Chat oder drück auf deiner Gewinnspielseite auf Preis abholen.",
  "live.claimHint.keyword":
    "{name}, schreib {keyword} in den Chat oder drück auf deiner Gewinnspielseite auf Preis abholen.",
  "live.claimHint.page": "{name}, drück auf deiner Gewinnspielseite auf Preis abholen.",
  "live.entries.label": "Teilnahme",
  "live.entries.open": "Offen",
  "live.entries.closed": "Beendet",
  "live.reroll.bar": "{name} neu ziehen",
  "live.reroll.label": "Neu ziehen",
  "live.overlay.link": "Overlay-Link",

  "wizard.step.basics": "Grundlagen",
  "wizard.step.rules": "Teilnahmeregeln",
  "wizard.step.review": "Prüfen",
  "wizard.q.basics": "Fang mit den Grundlagen an",
  "wizard.q.rules": "Leg die Teilnahmeregeln fest",
  "wizard.group.entry": "Wer und wie",
  "wizard.group.odds": "Chancen",
  "wizard.group.winners": "Gewinner",
  "wizard.q.audience": "Wer kann mitmachen",
  "wizard.q.review": "Prüf dein Gewinnspiel",
  "wizard.fix": "Bitte korrigier das, um weiterzumachen.",
  "wizard.start": "Gewinnspiel starten",
  "wizard.starting": "Startet…",
  "wizard.title.label": "Name des Gewinnspiels",
  "wizard.title.placeholder": "Gaming-Stuhl-Gewinnspiel am Freitag",
  "wizard.prize.label": "Was bekommt der Gewinner?",
  "wizard.prize.placeholder": "Ein Gaming-Stuhl oder eine Steam-Karte über 25 Euro",
  "wizard.audience.everyone": "Alle",
  "wizard.audience.everyone.help": "Jeder Zuschauer kann mitmachen.",
  "wizard.audience.followers": "Nur Follower",
  "wizard.audience.followers.help": "Nur Leute, die deinem Kanal folgen, können mitmachen.",
  "wizard.audience.subscribers": "Nur Abonnenten",
  "wizard.audience.subscribers.help": "Nur deine zahlenden Abonnenten können mitmachen.",
  "wizard.audience.subscribers.warning":
    "Teilnahme nur für Abonnenten kann in manchen Ländern als bezahlte Lotterie gelten.",
  "wizard.audience.subscribers.info":
    "Ein Abo ist ein bezahlter Kauf. In vielen Ländern ist ein Gewinnspiel, bei dem man zum Mitmachen etwas kaufen muss, eine regulierte Lotterie. Überleg, auch Follower oder alle Zuschauer mitmachen zu lassen.",
  "wizard.minAge.label": "Mindestalter des Kontos in Tagen",
  "wizard.minAge.help": "Sperrt frisch erstellte Konten aus.",
  "wizard.minAge.fewer": "Weniger Tage",
  "wizard.minAge.more": "Mehr Tage",
  "wizard.official.legend": "Offizielle Regeln (optional)",
  "wizard.official.help": "Nur wenn dein Gewinnspiel sie braucht.",
  "wizard.winnerAge.label": "Mindestalter zum Gewinnen, in Jahren",
  "wizard.winnerAge.info":
    "Rafflink kann das Alter nicht prüfen. Du prüfst es, bevor du den Preis übergibst.",
  "wizard.winnerAge.fewer": "Weniger Jahre",
  "wizard.winnerAge.more": "Mehr Jahre",
  "wizard.excludedCountries.label": "Orte, an denen man nicht gewinnen kann",
  "wizard.excludedCountries.help": "Rafflink kann nicht prüfen, wo jemand wohnt.",
  "wizard.excludedCountries.placeholder": "z. B. Quebec, Italien",
  "wizard.extraTerms.label": "Zusätzliche Bedingungen",
  "wizard.extraTerms.help": "Werden unter den Regeln genau so angezeigt, wie du sie schreibst.",
  "wizard.recent.legend": "Letzte Gewinner",
  "wizard.recent.off": "Aus",
  "wizard.recent.off.help": "Gewinner deiner früheren Gewinnspiele können wieder mitmachen.",
  "wizard.recent.giveaways": "Letzte Gewinnspiele",
  "wizard.recent.giveaways.help":
    "Gewinner deiner letzten gezogenen Gewinnspiele können nicht mitmachen.",
  "wizard.recent.days": "Letzte Tage",
  "wizard.recent.days.help":
    "Gewinner der Gewinnspiele, die du in den letzten Tagen erstellt hast, können nicht mitmachen.",
  "wizard.recent.count.giveaways": "Wie viele Gewinnspiele zurück",
  "wizard.recent.count.days": "Wie viele Tage zurück",
  "wizard.recent.fewer": "Weniger",
  "wizard.recent.more": "Mehr",
  "wizard.winnerForm.legend": "Gewinnerformular",
  "wizard.winnerForm.help": "Wird nach der Abholung abgefragt. Nur du siehst die Antworten.",
  "wizard.winnerForm.info":
    "Die Antworten werden gelöscht, wenn du den Preis als geliefert markierst, spätestens 30 Tage nach der Abholung.",
  "wizard.tickets.legend": "Extra-Tickets",
  "wizard.tickets.help": "Gib manchen Gruppen Extra-Tickets.",
  "wizard.tickets.fewer": "Weniger Tickets für {group}",
  "wizard.tickets.more": "Mehr Tickets für {group}",
  "odds.same": "Alle haben die gleiche Gewinnchance.",
  "odds.viewersOut": "Zuschauer bekommen keine Tickets und können nicht gewinnen.",
  "odds.noBetter": "Keine Gruppe hat bessere Chancen als ein Zuschauer.",
  "odds.follower": "Ein Follower hat die {times}-fache Chance eines Zuschauers.",
  "odds.sub_t1": "Ein Tier-1-Abonnent hat die {times}-fache Chance eines Zuschauers.",
  "odds.sub_t2": "Ein Tier-2-Abonnent hat die {times}-fache Chance eines Zuschauers.",
  "odds.sub_t3": "Ein Tier-3-Abonnent hat die {times}-fache Chance eines Zuschauers.",
  "odds.member": "Ein Kanalmitglied hat die {times}-fache Chance eines Zuschauers.",
  "odds.vip": "Ein VIP hat die {times}-fache Chance eines Zuschauers.",
  "odds.moderator": "Ein Moderator hat die {times}-fache Chance eines Zuschauers.",
  "wizard.ending.legend": "Wann endet die Teilnahme?",
  "wizard.ending.never": "Wenn ich sie beende",
  "wizard.ending.never.help": "Die Teilnahme bleibt offen, bis du auf Teilnahme beenden drückst.",
  "wizard.ending.atTime": "Zu einer festen Zeit",
  "wizard.ending.atTime.help": "Die Teilnahme endet von selbst zur gewählten Zeit.",
  "wizard.closesAt.label": "Teilnahme endet um",
  "wizard.closesAt.help": "Es gilt die Zeitzone dieses Geräts.",
  "wizard.claim.legend": "Zeit zum Abholen",
  "wizard.claim.custom": "Eigene",
  "wizard.claim.minutes": "Minuten",
  "wizard.claim.fewer": "Weniger Minuten",
  "wizard.claim.more": "Mehr Minuten",
  "wizard.keyword.label": "Abhol-Wort",
  "wizard.keyword.help": "Lass es leer, dann holt jede Chatnachricht des Gewinners den Preis ab.",
  "review.name": "Name",
  "review.prize": "Preis",
  "review.who": "Wer mitmachen kann",
  "review.tickets": "Tickets",
  "review.age": "Kontoalter",
  "review.end": "Teilnahme endet",
  "review.claim": "Zeit zum Abholen",
  "review.notSet": "Nicht festgelegt",
  "review.everyoneOne": "Alle bekommen 1 Ticket.",
  "review.ageText": "Konten müssen mindestens {days} alt sein.",
  "review.winnerAge": "Mindestalter zum Gewinnen",
  "review.excludedCountries": "Kein Gewinn möglich in",
  "review.extraTerms": "Zusätzliche Bedingungen",
  "review.recent": "Letzte Gewinner",
  "review.endsManual": "Wenn du sie beendest.",
  "review.claimText": "{time}. {chat}",
  "review.anyChat": "Jede Chatnachricht des Gewinners zählt ebenfalls.",
  "review.keywordChat": "Der Gewinner kann auch „{keyword}“ in deinen Chat schreiben.",
  "wizard.entry.legend": "Wie Zuschauer mitmachen",
  "wizard.entry.page": "Gewinnspielseite",
  "wizard.entry.page.help": "Zuschauer melden sich auf der Gewinnspielseite an.",
  "wizard.entry.both": "Seite und Chat",
  "wizard.entry.both.help":
    "Zuschauer können auch mitmachen, indem sie ein Stichwort in deinen Chat schreiben.",
  "wizard.entry.chat": "Nur Chat",
  "wizard.entry.chat.help":
    "Zuschauer machen nur mit, indem sie ein Stichwort in deinen Chat schreiben. Die Seite zeigt das Stichwort und lässt sie prüfen, ob sie dabei sind.",
  "wizard.reconnect.followers.info":
    "Um zu prüfen, wer dir folgt, muss Rafflink deine Follower lesen. Verbinde Twitch neu; deine Antworten bleiben erhalten.",
  "wizard.reconnect.subs.info":
    "Um neue Abonnenten einzutragen oder Abonnenten ihre Lose zu geben, muss Rafflink deine Abonnenten lesen. Verbinde Twitch neu; deine Antworten bleiben erhalten.",
  "wizard.reconnect.redemptions.info":
    "Um Zuschauer einzutragen, die eine Kanalpunkte-Belohnung einlösen, muss Rafflink deine Belohnungen und Einlösungen lesen. Verbinde Twitch neu; deine Antworten bleiben erhalten.",
  "wizard.reconnect.roles.info":
    "Um VIPs und Moderatoren ihre Lose zu geben, muss Rafflink deine VIPs und Moderatoren lesen. Verbinde Twitch neu; deine Antworten bleiben erhalten.",
  "wizard.reconnect.modlinks.info":
    "Um zu prüfen, wer deinen Kanal moderiert, muss Rafflink deine Moderatoren lesen. Verbinde Twitch neu und erstelle dann den Link.",
  "wizard.reconnect.points.info.kick":
    "Um deine Kanalpunkte-Belohnungen aufzulisten, muss Rafflink sie lesen. Verbinde Kick neu; deine Antworten bleiben erhalten.",
  "wizard.reconnect.button": "{platform} neu verbinden",
  "wizard.reconnect.text": "Braucht noch eine {platform}-Berechtigung.",
  "wizard.chatKeyword.label": "Teilnahme-Stichwort",
  "wizard.chatKeyword.help":
    "Eine Chatnachricht, die mit diesem Wort beginnt, trägt den Zuschauer ein.",
  "wizard.chatKeyword.info":
    "Gleiche Regeln und Tickets wie auf der Seite. Rafflink schreibt nie in deinen Chat.",
  "wizard.chatCost.kick":
    "Verbraucht pro Chatnachricht eine Serveranfrage. Heute noch {remaining} übrig.",
  "wizard.chatCost.kick.info":
    "Kick schickt jede Chatnachricht an Rafflink, solange die Teilnahme offen ist, mit oder ohne Stichwort. Dieser Server erlaubt {limit} Anfragen pro Tag; ein Chat mit 100 Nachrichten pro Minute verbraucht 6.000 pro Stunde.",
  "wizard.chatCost.youtube":
    "Das Chat-Lesen verbraucht YouTube-Einheiten. Heute noch {remaining} übrig.",
  "wizard.chatCost.topic": "Kosten fürs Chat-Lesen",
  "wizard.chatCost.youtube.info":
    "Rafflink liest den Chat, solange die Teilnahme offen ist, etwa {perMinute} Einheiten pro Minute, und nach der Ziehung, bis die Gewinner abholen, etwa {winnerPerMinute} pro Minute. Dieser Server hat {limit} Einheiten pro Tag.",
  "wizard.chatCost.youtubeByHand":
    "Du beendest dieses Gewinnspiel von Hand, daher kann der Server nicht vorab prüfen, ob die Einheiten von heute reichen: Sie decken etwa {minutes} Minuten Teilnahme. Lege ein Ende fest, damit es geprüft wird.",
  "wizard.autoEntry.legend": "Automatische Teilnahmen",
  "wizard.subEntry.label": "Neue Abonnenten eintragen",
  "wizard.subEntry.help":
    "Neue Abonnenten sind einmal dabei. Teilnahme über die Seite oder den Chat bleibt kostenlos.",
  "wizard.subEntry.info":
    "Wer abonniert, ein Geschenk-Abo bekommt oder ein Resub im Chat teilt, solange die Teilnahme offen ist, macht einmal mit, mit den Tickets seines Tiers. Eine stille automatische Verlängerung zählt nicht: Twitch meldet nur Verlängerungen, die der Zuschauer teilt. Die Teilnahme über die Seite oder den Chat bleibt kostenlos, niemand muss also zahlen, um mitzumachen.",
  "wizard.subEntry.info.kick":
    "Wer abonniert, verlängert oder ein Geschenk-Abo bekommt, solange die Teilnahme offen ist, macht einmal mit, mit den Tickets eines Abonnenten. Kick hat nur eine Abo-Stufe und meldet jede Verlängerung. Die Teilnahme über die Seite oder den Chat bleibt kostenlos, niemand muss also zahlen, um mitzumachen.",
  "wizard.points.legend": "Kanalpunkte-Belohnung",
  "wizard.points.help":
    "Zuschauer, die diese Belohnung einlösen, solange die Teilnahme offen ist, machen einmal mit, wie bei jeder anderen Teilnahme. Das Einlösen bringt keine Extra-Tickets und keine bessere Gewinnchance.",
  "wizard.points.none":
    "Dein Kanal hat noch keine Kanalpunkte-Belohnungen. Erstell eine in deinen Kanaleinstellungen und öffne diesen Schritt dann noch einmal.",
  "wizard.points.off": "Keine Belohnung",
  "wizard.points.selected":
    "Rafflink markiert die Einlösung nicht als erledigt; bearbeite sie wie gewohnt in deiner Belohnungswarteschlange.",
  "review.entry": "Teilnahme",
  "review.entryPage": "Auf der Gewinnspielseite.",
  "review.entryBoth": "Auf der Gewinnspielseite oder mit „{keyword}“ in deinem Chat.",
  "review.entryChat": "Nur mit „{keyword}“ in deinem Chat.",
  "review.subEntry": "Neue Abonnenten machen von selbst mit.",
  "review.pointsEntry": "Wer „{reward}“ einlöst, macht mit.",
  "giveaway.chatEntry": "Oder schreib {keyword} in den Chat von {name}, um mitzumachen.",
  "giveaway.lookup.legend": "Per Chat mitgemacht?",
  "giveaway.lookup.label": "Dein Benutzername",
  "giveaway.lookup.button": "Bin ich dabei?",
  "giveaway.lookup.yes": "{login} ist im Gewinnspiel.",
  "giveaway.lookup.no":
    "{login} ist noch nicht im Gewinnspiel. Eine Teilnahme per Chat kann eine Minute brauchen, bis sie erscheint.",
  "giveaway.lookup.failed": "Die Prüfung hat nicht geklappt. Versuch es noch mal.",

  "legal.privacy": "Datenschutz",
  "legal.terms": "Nutzungsbedingungen",
  "legal.footerLabel": "Rechtliches",
  "legal.updated": "Zuletzt aktualisiert: {date}",

  "legal.operator.id": "Unternehmens-ID {id}",
  "legal.unavailable":
    "Die Angaben dazu, wer diese Instanz betreibt, konnten nicht geladen werden.",
  "legal.retry": "Noch mal versuchen",
  "legal.englishPrevails":
    "Dies ist eine Übersetzung. Wo sie von der englischen Fassung abweicht, gilt die englische Fassung.",

  "privacy.title": "Datenschutzerklärung",
  "privacy.controller.h": "Wer verantwortlich ist",
  "privacy.controller.p1":
    "Verantwortlicher für deine personenbezogenen Daten auf dieser Instanz ist {operator}. Kontakt: {contact}.",
  "privacy.controller.none":
    "Diese Instanz wird von ihrem Betreiber betrieben, der hier keine Kontaktdaten veröffentlicht hat. Die Software sendet keine Daten an das Rafflink-Projekt. Um ein Datenschutzrecht auszuüben oder eine Frage zu stellen, wende dich an die Person, die den Link mit dir geteilt hat.",
  "privacy.controller.p2":
    "Rafflink ist Open Source und jeder kann eine eigene Kopie betreiben. Dieser Text beschreibt, was die Software tut; wer eine Instanz betreibt, ist Verantwortlicher für die Daten darauf. Das Rafflink-Projekt erhält keine Daten von Instanzen, die andere betreiben.",
  "privacy.data.h": "Welche Daten verarbeitet werden",
  "privacy.data.p1":
    "Alles kommt von Twitch, Kick oder YouTube, je nachdem, womit du dich anmeldest. Rafflink fragt nur Lesezugriff an und postet nie in den Chat.",
  "privacy.data.i1":
    "Streamer: Plattform-Benutzer-ID, Login-Name, der frühere Login-Name nach einer Umbenennung (aufbewahrt, damit ein Link auf die alte öffentliche Verlaufsseite weiterleitet), Anzeigename, die URL des Profilbilds und der Zeitpunkt der ersten Anmeldung, dazu die Gewinnspiele, die sie erstellen (Titel, Preistext, Regeln, Link-Code, Zeiten), und deren Ergebnisse.",
  "privacy.data.i2":
    "Streamer: das Refresh-Token der Plattform, verschlüsselt gespeichert. Damit kann Rafflink während eines Gewinnspiels die VIP- und Moderatorenlisten des Kanals und den Chat lesen und prüfen, ob jemand, der einen Moderatorenlink öffnet, den Kanal moderiert.",
  "privacy.data.i3":
    "Teilnehmer: Plattform-Benutzer-ID, Login-Name, Anzeigename, die URL des Profilbilds, die Gruppe, die die Tickets gebracht hat (Zuschauer, Follower, Abo-Tier, VIP oder Moderator), Anzahl der Tickets, Zeitpunkt der Teilnahme und ein Zufallswert (Salt), der die Ziehung überprüfbar macht. Für die Follow- und Abo-Prüfung wird dein Twitch-Token einmal verwendet und nicht gespeichert.",
  "privacy.data.i4":
    "Alle Gezogenen, einschließlich neu gezogener Plätze: Plattform-Benutzer-ID, Login-Name, Anzeigename, das Ergebnis der Ziehung und ob und wie der Preis abgeholt wurde. Die Benutzer-ID bleibt bei der Ziehung, auch nachdem der Name durch „entfernt“ ersetzt wurde.",
  "privacy.data.i5":
    "Chatnachrichten: werden im Arbeitsspeicher gelesen, um das Teilnahme-Stichwort und die Abholung eines Gewinners zu erkennen und die Nachrichten des Gewinners auf der Live-Seite zu zeigen. Sie werden nie gespeichert oder protokolliert. Wenn du das Teilnahme-Stichwort schreibst, werden deine Plattform-Benutzer-ID, dein Login, dein Anzeigename und die Rollen, die deine Chat-Abzeichen zeigen, gespeichert, bis die Teilnahme geprüft ist; danach bist du Teilnehmer wie auf der Seite, und der Follow wird mit dem Token des Streamers geprüft.",
  "privacy.data.i6":
    "Technische Daten: Der Hoster verarbeitet deine IP-Adresse und Details der Anfrage, um die Seite auszuliefern und vor Missbrauch zu schützen, zum Beispiel mit Ratenlimits.",
  "privacy.data.i7":
    "Gewinnspielräume: die Twitch-Benutzer-IDs der VIPs und Moderatoren des Kanals, gespeichert, um die Ticketregeln anzuwenden. Sie werden mit den Teilnahmen des Gewinnspiels gelöscht.",
  "privacy.data.i8":
    "Moderatoren, die einen Moderatorenlink öffnen: Der Link speichert nur einen Hash seines Geheimnisses. Ist ein Link für Kanalmoderatoren, meldet sich der Moderator mit Twitch an und Rafflink gleicht die Twitch-Benutzer-ID mit den Moderatoren des Kanals ab. Die ID wird nur im Cookie des Moderators aufbewahrt, sonst wird nichts über ihn gespeichert, und kein Twitch-Token wird aufbewahrt.",
  "privacy.data.i9":
    "Blockierte Konten: Ein Streamer kann Konten von seinen Gewinnspielen ausschließen. Rafflink speichert dann die Plattform-Benutzer-ID und den Login-Namen der blockierten Person sowie den Zeitpunkt der Blockierung beim Konto des Streamers. Jeder Gewinnspielraum des Streamers behält eine Kopie der blockierten Benutzer-IDs, um sie abweisen zu können. Hatte die Person bereits an einem noch offenen Gewinnspiel teilgenommen, wird diese Teilnahme gelöscht.",
  "privacy.data.i10":
    "Letzte Gewinner: Wenn ein Streamer letzte Gewinner ausschließt, werden die Plattform-Benutzer-IDs der Gewinner seiner früheren Gewinnspiele in den Raum des neuen Gewinnspiels kopiert, damit er sie abweisen kann.",
  "privacy.data.i11":
    "Gewinner, die ein Gewinnerformular ausfüllen: die Antworten, die der Streamer angefragt hat, etwa Name, E-Mail, Lieferadresse, eine Spielkonto-ID oder eine Nachricht an den Streamer. Sie werden verschlüsselt gespeichert, nur der Streamer des Gewinnspiels kann sie lesen, um den Preis zu liefern, und sie werden nie in Logs geschrieben. Der Gewinner kann das Formular einmal senden.",
  "privacy.purposes.h": "Warum und auf welcher Rechtsgrundlage",
  "privacy.purposes.i1":
    "Um die Gewinnspiele zu betreiben, die Streamer erstellen, und Zuschauer daran teilnehmen zu lassen, einschließlich Ziehung und Abholung: Erfüllung eines Vertrags mit dir, der Dienst, den du angefragt hast (Art. 6 Abs. 1 lit. b DSGVO).",
  "privacy.purposes.i2":
    "Um den Dienst sicher und fair zu halten: eine Teilnahme pro Konto, Ratenlimits, stündliche Prüfung der Streamer-Tokens. Unser berechtigtes Interesse (Art. 6 Abs. 1 lit. f).",
  "privacy.purposes.i3":
    "Um dich mit Cookies angemeldet zu halten, die dafür unbedingt erforderlich sind. Rafflink nutzt keine Werbung, keine Analysetools und kein Tracking, und es verkauft oder teilt keine Daten für Marketing. Es speichert nur zusammengefasste Zahlen ohne personenbezogene Daten, etwa Besuche pro Empfehlungs-Label und Tag sowie Teilnahmen und Abholungen pro Minute.",
  "privacy.retention.h": "Wie lange Daten aufbewahrt werden",
  "privacy.retention.i1":
    "Teilnahmen (Plattform-Benutzer-IDs, Namen, Bild-URLs, Gruppen, Tickets, Teilnahmezeitpunkte, Salts) werden spätestens 30 Tage nach dem Ende des Gewinnspiels gelöscht; der Betreiber kann eine kürzere Frist festlegen. Dabei werden auch die Teilnahmen der Gezogenen gelöscht; ihre Benutzer-ID und Namen bleiben bei ihrer Ziehung, einschließlich neu gezogener Plätze (siehe unten).",
  "privacy.retention.i2":
    "Wenn ein Streamer den Zugriff von Rafflink auf Twitch, Kick oder YouTube entfernt, wird nur das gespeicherte Token gelöscht. Das Konto und seine Gewinnspiele bleiben, bis der Streamer sie im Dashboard löscht, ein Gewinnspiel oder alle Daten auf einmal, oder den Betreiber darum bittet (siehe Kontakt oben).",
  "privacy.retention.i3":
    "Anmeldecodes, die in der Warteschlange warten, werden nach wenigen Minuten verworfen.",
  "privacy.retention.i4":
    "Hoster-Logs werden vom Betreiber oder seinem Hosting-Anbieter nach deren eigenen Bedingungen aufbewahrt.",
  "privacy.retention.i5":
    "Das Gewinnspiel (Titel, Preis, Regeln, Daten, Anzahl der Teilnehmer und Tickets), alle Gezogenen, einschließlich neu gezogener Plätze, mit Plattform-Benutzer-ID, Login-Name, Anzeigename und Abholstatus, die Merkle-Wurzel der Teilnahmeliste und die Liste ihrer Blätter (Hashes und Ticketzahlen, keine Namen) bleiben, bis der Streamer das Gewinnspiel löscht, damit der Preis geliefert und die Ziehung später von jedem geprüft werden kann. Der Betreiber kann eine Anzahl von Tagen nach Abschluss der Ziehung festlegen, nach der Gewinnspiele gelöscht werden.",
  "privacy.retention.i6":
    "Eine Blockierung (Plattform-Benutzer-ID und Login-Name) wird aufbewahrt, um diese Person von den Gewinnspielen des Streamers fernzuhalten, bis der Streamer sie im Dashboard entfernt oder sein Konto löscht. Die Kopien blockierter Benutzer-IDs und der IDs letzter Gewinner in einem Gewinnspielraum werden mit den Teilnahmen dieses Gewinnspiels gelöscht, spätestens 30 Tage nach seinem Ende.",
  "privacy.retention.i7":
    "Antworten im Gewinnerformular werden gelöscht, wenn der Streamer den Preis als geliefert markiert, spätestens 30 Tage nach der Abholung; der Betreiber kann eine kürzere Frist festlegen. Nur die Zeitpunkte, wann das Formular gesendet und wann der Preis geliefert wurde, bleiben bei der Ziehung. Wird das Gewinnspiel oder das Konto des Streamers gelöscht, werden die Antworten sofort gelöscht.",
  "privacy.recipients.h": "Wer die Daten sonst noch sieht",
  "privacy.recipients.p1": "Rafflink verkauft keine Daten. Daten gehen nur an diese Stellen.",
  "privacy.recipients.i1":
    "Der Hosting-Anbieter dieser Instanz speichert und liefert den Dienst als Auftragsverarbeiter des Betreibers aus und kann Daten nach seinen eigenen Bedingungen und Garantien außerhalb des Europäischen Wirtschaftsraums verarbeiten.",
  "privacy.recipients.i2":
    "Twitch ist der Identitätsanbieter für Anmeldungen mit Twitch. Twitch erhält deine Anmeldung und während eines Gewinnspiels API-Aufrufe, die Follows, Abos und Rollen prüfen, sowie das Chat-Abonnement, mit dem eine Abholung erkannt wird. Der Browser des Streamers lädt außerdem Profilbilder und Abo-Abzeichen von den Bildservern von Twitch. Twitch ist ein eigenständiger Verantwortlicher nach seiner eigenen Datenschutzerklärung. Kick ist der Identitätsanbieter für Anmeldungen mit Kick. Kick erhält deine Anmeldung und während eines Gewinnspiels das Abonnement, das die Chatnachrichten des Streamers an Rafflink sendet. Kick ist ein eigenständiger Verantwortlicher nach seiner eigenen Datenschutzerklärung. Google ist der Identitätsanbieter für Anmeldungen mit YouTube. Es erhält die Anmeldung des Streamers und während eines Gewinnspiels die API-Aufrufe, die den Livestream finden und seinen Chat lesen. Google ist ein eigenständiger Verantwortlicher nach seiner eigenen Datenschutzerklärung.",
  "privacy.recipients.i3":
    "Der Streamer, der ein Gewinnspiel leitet, sieht dessen Teilnehmer und Gewinner. Die Namen von Teilnehmern und Gewinnern werden auf der Live-Seite und im Overlay des Gewinnspiels gezeigt, ihre Profilbilder auf der Live-Seite.",
  "privacy.recipients.i4":
    "Für die Ziehung wird das öffentliche Zufallsbeacon drand gelesen. Es werden keine personenbezogenen Daten an es gesendet.",
  "privacy.recipients.i5":
    "Wenn ein Streamer seinen öffentlichen Verlauf einschaltet, kann dort jeder den Namen des Streamers und seine beendeten Gewinnspiele sehen: Titel, Preis, Enddatum und die Zahl der Teilnehmer und Gewinner. Die Seite nennt keine Teilnehmer und keine Gewinner, und der Streamer kann einzelne Gewinnspiele ausblenden oder die Seite ausschalten. Suchmaschinen indexieren die Seite nur, wenn der Streamer es erlaubt.",
  "privacy.recipients.i6":
    "Antworten im Gewinnerformular gehen an den Streamer, der das Gewinnspiel leitet, und an niemanden sonst: Moderatoren, das Overlay und die öffentlichen Seiten zeigen sie nie.",
  "privacy.recipients.i7":
    "Wenn der Betreiber die Fehlerberichte einschaltet, empfängt Sentry (Functional Software, Inc.) als Auftragsverarbeiter des Betreibers Berichte über Fehler im Browser und auf dem Server und speichert sie in seiner EU-Region in Deutschland. Ein Bericht enthält den Fehler, den Ort, an dem er auftrat, den Browser und das Betriebssystem; wie jeder Server sieht Sentry die IP-Adresse der Verbindung. Cookies, Inhalte von Anfragen, Anmeldecodes, Twitch-, Kick- und Google-Tokens und die Formularantworten der Gewinner werden vor dem Senden eines Berichts entfernt.",
  "privacy.youtube.h": "YouTube",
  "privacy.youtube.p1":
    "Rafflink nutzt die YouTube API Services. Wenn du dich mit YouTube anmeldest, stimmst du den Nutzungsbedingungen von YouTube zu ({youtubeTerms}). Für das, was Google mit deinen Daten macht, gilt die Datenschutzerklärung von Google ({googlePrivacy}).",
  "privacy.youtube.i2":
    "Zuschauer melden sich nie mit Google an. Sie machen mit, indem sie das Stichwort in den Chat schreiben, und Rafflink liest ihre Kanal-ID, den im Chat angezeigten Namen, die Nachricht und ob sie Kanalmitglied oder Moderator sind.",
  "privacy.youtube.i3":
    "YouTube-Daten von Zuschauern, die Rafflink speichert, werden innerhalb von 30 Tagen gelöscht: die Teilnahmen spätestens 30 Tage nach Ende des Gewinnspiels und mit ihnen die Namen der Gewinner, sodass bei der Ziehung nur ihre Kanal-ID bleibt.",
  "privacy.cookies.h": "Cookies und lokaler Speicher",
  "privacy.cookies.p1":
    "Rafflink setzt nur unbedingt erforderliche Cookies, deshalb wird kein Einwilligungsbanner gezeigt. Alle sind HTTP-only und werden für nichts anderes verwendet.",
  "privacy.cookies.i1": "rl_streamer: hält einen Streamer angemeldet, standardmäßig 7 Tage.",
  "privacy.cookies.i2":
    "rl_viewer: lässt einen wiederkehrenden Zuschauer sein Ergebnis ohne erneute Anmeldung sehen, standardmäßig 30 Tage.",
  "privacy.cookies.i3":
    "rl_oauth_streamer_* und rl_oauth_viewer_*: schützen eine Anmeldung vor Fälschung, standardmäßig 10 Minuten.",
  "privacy.cookies.i4":
    "rl_pending_*: lässt den Browser, der eine Teilnahme in die Warteschlange gestellt hat, ihr Ergebnis abholen, standardmäßig 10 Minuten.",
  "privacy.cookies.i5":
    "Der lokale Speicher deines Browsers speichert deine Sprach- und Designwahl und den Clean-Modus der Live-Seite. Der Sitzungsspeicher behält eine Kopie der geladenen Gewinnspielseite, einschließlich deines eigenen Status darin, für etwa 30 Sekunden. Beides verlässt dein Gerät nicht.",
  "privacy.cookies.i7":
    "rl_entry_scopes: merkt sich, welche zusätzlichen Berechtigungen (Follower, Abonnenten, Belohnungen, VIPs und Moderatoren) die letzte Streamer-Anmeldung in diesem Browser erlaubt hat, damit die nächste Anmeldung sie wieder anfragt; 400 Tage, bleibt beim Abmelden erhalten.",
  "privacy.cookies.i6":
    "rl_mod_*: lässt die Person, die einen Moderatorenlink geöffnet hat, die Moderatorenseite dieses Gewinnspiels nutzen, standardmäßig 7 Tage oder bis der Streamer den Link widerruft. rl_mod_pending: merkt sich, welcher Link auf die Twitch-Anmeldung des Moderators wartet, standardmäßig 10 Minuten.",
  "privacy.rights.h": "Deine Rechte",
  "privacy.rights.p1":
    "Du hast die unten aufgeführten Rechte. Schreib an {contact}. Wir antworten innerhalb eines Monats.",
  "privacy.rights.none":
    "Der Betreiber dieser Instanz hat hier keine Kontaktdaten veröffentlicht, und die Person, die den Link mit dir geteilt hat, ist vielleicht nicht der Betreiber. Ohne Kontakt gibt es keinen zugesicherten Weg, diese Rechte über diese Seite auszuüben.",
  "privacy.rights.p2":
    "Du kannst den Zugriff von Rafflink auch jederzeit in deinen Twitch-Einstellungen unter Verbindungen, in deinen Kick-Kontoeinstellungen oder in den Berechtigungen deines Google-Kontos entfernen.",
  "privacy.rights.i1":
    "Auskunft, Berichtigung, Einschränkung der Verarbeitung und Übertragbarkeit deiner Daten.",
  "privacy.rights.i2":
    "Löschung, zum Beispiel des Namens eines Gewinners, der nach dem Gewinnspiel bleibt: Der Betreiber ersetzt ihn durch „entfernt“, und die Ziehung bleibt überprüfbar.",
  "privacy.rights.i3":
    "Widerspruch gegen eine Verarbeitung, die auf unserem berechtigten Interesse beruht.",
  "privacy.rights.i4":
    "Eine Beschwerde bei der Datenschutzbehörde des Landes, in dem du lebst oder arbeitest oder in dem deiner Meinung nach deine Rechte verletzt wurden.",
  "privacy.changes.h": "Änderungen",
  "privacy.changes.p1": "Wenn sich diese Erklärung ändert, ändert sich auch das Datum oben.",

  "terms.title": "Nutzungsbedingungen",
  "terms.intro":
    "Wenn du dich bei Rafflink anmeldest oder an einem Gewinnspiel teilnimmst, akzeptierst du diese Bedingungen. Wenn du sie nicht akzeptierst, nutze den Dienst nicht.",
  "terms.service.h": "Der Dienst",
  "terms.service.p1":
    "Mit Rafflink kann ein Streamer auf Twitch, Kick oder YouTube ein Gewinnspiel erstellen, Teilnahmen sammeln und Gewinner live ziehen. Diese Instanz wird von {operator} betrieben.",
  "terms.service.none":
    "Mit Rafflink kann ein Streamer auf Twitch, Kick oder YouTube ein Gewinnspiel erstellen, Teilnahmen sammeln und Gewinner live ziehen. Diese Instanz wird von ihrem Betreiber betrieben, der hier keine Kontaktdaten veröffentlicht hat. Wende dich an die Person, die den Link mit dir geteilt hat.",
  "terms.service.p2":
    "Der Dienst wird so bereitgestellt, wie er ist und wie er verfügbar ist, ohne jede Gewährleistung. Er kann jederzeit geändert, eingeschränkt oder eingestellt werden und hat keine Verfügbarkeitsgarantie.",
  "terms.source.h": "Open Source",
  "terms.source.p1":
    "Der Quellcode steht unter der GNU AGPL-3.0 und ist unter {repository} verfügbar. Die Lizenz gilt für den Code. Diese Bedingungen gelten für den Dienst auf dieser Instanz.",
  "terms.streamers.h": "Streamer und Veranstalter",
  "terms.streamers.p1":
    "Du bist der Veranstalter jedes Gewinnspiels, das du erstellst. Rafflink stellt nur das Werkzeug und die Ziehung bereit. Rafflink ist nicht der Veranstalter.",
  "terms.streamers.i1":
    "Du allein bist dafür verantwortlich, dass jedes Gewinnspiel dem Recht dort entspricht, wo du und deine Zuschauer sind: Preis, Regeln, Teilnahmeberechtigung, Alters- und Länderbeschränkungen, Steuern, Glücksspiel- und Lotterieregeln und die Lieferung des Preises.",
  "terms.streamers.i2":
    "Kostenpflichtige Teilnahme ist nicht erlaubt. Ein Gewinnspiel darf keine Zahlung für die Teilnahme verlangen, daher sind bezahlte Verlosungen und Lotterien auf Rafflink nicht erlaubt.",
  "terms.streamers.i3":
    "Extra-Tickets für Abonnenten oder Follower sind deine Entscheidung. Ein Abo ist ein bezahlter Kauf, daher kann ein Gewinnspiel nur für Abonnenten dort, wo du oder deine Zuschauer leben, als kostenpflichtige Teilnahme gelten. Prüf das, bevor du es wählst.",
  "terms.streamers.i4":
    "Du bist dafür verantwortlich, wie du die Daten der Teilnehmer verwendest, die du siehst, nach dem Datenschutzrecht, das für dich gilt.",
  "terms.viewers.h": "Zuschauer",
  "terms.viewers.i1":
    "Die Teilnahme ist auf Seiten von Rafflink immer kostenlos und erfordert ein Twitch-, Kick- oder YouTube-Konto. Rafflink verlangt von Zuschauern nie eine Zahlung.",
  "terms.viewers.i2":
    "Der Preis kommt vom Streamer, nicht von Rafflink. Rafflink ist keine Partei des Gewinnspiels und verspricht weder einen Preis noch dessen Lieferung.",
  "terms.viewers.i3":
    "Ein Gewinn muss innerhalb der Zeit abgeholt werden, die der Streamer festgelegt hat. Danach kann der Streamer neu ziehen.",
  "terms.platforms.h": "Twitch, Kick und YouTube",
  "terms.platforms.p1":
    "Die Nutzungsbedingungen, Community-Richtlinien und die Developer Services Agreement von Twitch gelten für deine Nutzung von Twitch über Rafflink. Rafflink ist nicht mit Twitch verbunden und wird nicht von Twitch unterstützt. Die Bedingungen und Richtlinien von Kick gelten für deine Nutzung von Kick über Rafflink, und Rafflink ist auch nicht mit Kick verbunden oder von Kick unterstützt.",
  "terms.platforms.p2":
    "Rafflink nutzt die YouTube API Services, und für deine Nutzung von YouTube über Rafflink gelten die Nutzungsbedingungen von YouTube ({youtubeTerms}). Rafflink ist weder mit YouTube noch mit Google verbunden und wird von keinem der beiden unterstützt.",
  "terms.use.h": "Zulässige Nutzung",
  "terms.use.p1": "Du verpflichtest dich, nicht:",
  "terms.use.i1": "Bots, Skripte oder andere Automatisierung zum Mitmachen oder Abholen zu nutzen,",
  "terms.use.i2":
    "mit mehr als einem Konto mitzumachen oder das Konto einer anderen Person zu nutzen,",
  "terms.use.i3":
    "Teilnahmeregeln, Ratenlimits oder andere Schutzmaßnahmen zu umgehen oder den Dienst zu stören,",
  "terms.use.i4":
    "rechtswidrige Gewinnspiele zu veranstalten oder rechtswidrige oder missbräuchliche Inhalte in einen Titel oder Preistext zu setzen.",
  "terms.liability.h": "Haftung",
  "terms.liability.p1":
    "Soweit gesetzlich zulässig, haften wir nicht für indirekte Schäden oder Folgeschäden, für ein Gewinnspiel, einen Preis oder einen Streit zwischen einem Streamer und einem Zuschauer oder für einen Ausfall von Rafflink, Twitch, Kick oder YouTube. Unsere Gesamthaftung ist auf den Betrag begrenzt, den du uns für den Dienst gezahlt hast, bei einem kostenlosen Konto also auf nichts.",
  "terms.liability.p2":
    "Nichts hier schränkt eine Haftung ein, die gesetzlich nicht eingeschränkt werden kann, etwa die Haftung für Vorsatz oder für Körperverletzung, oder deine Rechte als Verbraucher.",
  "terms.changes.h": "Änderungen",
  "terms.changes.p1":
    "Wir können diese Bedingungen ändern. Das Datum oben zeigt die aktuelle Fassung, und wer den Dienst nach einer Änderung nutzt, akzeptiert sie. Wir können ein Gewinnspiel entfernen oder ein Konto sperren, das gegen diese Bedingungen verstößt.",
  "terms.contact.h": "Kontakt",
  "terms.contact.p1": "Fragen zu diesen Bedingungen: {contact}.",
  "terms.contact.none":
    "Der Betreiber dieser Instanz hat hier keine Kontaktdaten veröffentlicht. Die Person, die den Link mit dir geteilt hat, ist vielleicht nicht der Betreiber.",
  "drawResult.round-pending":
    "Die Zufallszahl ist noch nicht veröffentlicht. Der Gewinner wird von selbst gezogen, sobald sie da ist.",
  "drawResult.round-due":
    "Die Zufallszahl ist unterwegs. Der Gewinner wird gleich von selbst gezogen.",
  "drawResult.beacon-unavailable":
    "Die Zufallsquelle (drand) war nicht erreichbar. Es wurde nichts gezogen. Versuch es noch mal.",
  "giveaway.verify.link": "Diese Ziehung prüfen",
  "viewer.runYourOwn": "Starte dein eigenes Gewinnspiel mit Rafflink",
  "verify.title": "Diese Ziehung prüfen",
  "verify.intro":
    "Prüf in deinem Browser, dass sich die Gewinner aus der Teilnahmeliste und einer öffentlichen Zufallszahl ergeben, die hier niemand kontrolliert.",
  "verifyLookup.title": "Ziehung prüfen",
  "verifyLookup.label": "Code oder Link des Gewinnspiels",
  "verifyLookup.help":
    "Ein Code hat 5 Buchstaben und Ziffern, etwa YNX9N. Du kannst auch den Link einfügen, den Zuschauer verwenden.",
  "verifyLookup.invalid": "Das ist kein Code oder Link eines Gewinnspiels.",
  "verifyLookup.submit": "Prüfung öffnen",
  "verify.back": "Zurück zum Gewinnspiel",
  "verify.open":
    "Die Teilnahme ist noch offen. Die Teilnahmeliste wird festgeschrieben, wenn sie endet.",
  "verify.closed.pending":
    "Die Teilnahme ist beendet und die Liste wird festgeschrieben. Lade gleich neu.",
  "verify.unverifiable":
    "Dieses Gewinnspiel wurde gezogen, bevor Ziehungen prüfbar waren, es gibt also nichts zu prüfen.",
  "verify.facts.entrants": "Teilnehmer",
  "verify.facts.tickets": "Tickets",
  "verify.facts.root": "Merkle-Wurzel",
  "verify.facts.chain": "drand-Kette",
  "verify.facts.round": "drand-Runde",
  "verify.facts.leaves": "Teilnahmeliste",
  "verify.facts.leavesLink": "Teilnahmeliste öffnen",
  "verify.run": "Prüfen",
  "verify.running": "Wird geprüft…",
  "verify.verdict.verified": "Ziehung geprüft",
  "verify.verdict.failed": "Ziehung stimmt nicht",
  "verify.verdict.incomplete": "Nicht alles ließ sich prüfen",
  "verify.checks.summary": "Was geprüft wurde",
  "verify.check.counts.match": "Die Liste hat so viele Teilnahmen und Tickets wie angekündigt.",
  "verify.check.counts.mismatch":
    "Die Liste hat nicht die angekündigte Zahl an Teilnahmen und Tickets.",
  "verify.check.root.match": "Die Merkle-Wurzel der Liste ist die veröffentlichte Wurzel.",
  "verify.check.root.mismatch": "Die Merkle-Wurzel der Liste ist nicht die veröffentlichte Wurzel.",
  "verify.check.signature.valid": "Die Signatur der drand-Runde {round} ist gültig.",
  "verify.check.signature.invalid":
    "Die Signatur der drand-Runde {round} ist ungültig, daher kann nichts weiter unten vertraut werden.",
  "verify.check.signature.unavailable":
    "Die Signatur der drand-Runde {round} konnte nicht geprüft werden.",
  "verify.check.signature.none":
    "Es wird noch keine Runde gebraucht, es gibt also keine Signatur zu prüfen.",
  "verify.check.winners.match":
    "Die Gewinner ergeben sich aus der Liste und der Zufallszahl der drand-Runde {round}.",
  "verify.check.winners.mismatch":
    "Die Gewinner ergeben sich nicht aus der Liste und der Zufallszahl der drand-Runde {round}.",
  "verify.check.winners.unavailable":
    "Die drand-Runde {round} konnte nicht gelesen werden. Versuch es später noch mal.",
  "verify.check.winners.none":
    "Es sind noch keine Gewinner gezogen, es gibt also nichts zu vergleichen.",
  "verify.winners.title": "Gewinner",
  "verify.winners.showAll": "Alle {count} Ziehungen zeigen",
  "verify.winner.entry": "Ziehung {n} ist Eintrag {leaf} der Liste.",
  "verify.winner.rerolled": "(neu gezogen)",
  "live.draw.fixed":
    "Gewinner gezogen: {drawn} von {planned} geplant. Zieh so viele weitere, wie du brauchst.",
  "live.winners.save": "Speichern",
  "winnersResult.set": "Gewinnerzahl gespeichert.",
  "winnersResult.rejected":
    "Speichern fehlgeschlagen. Gib eine ganze Zahl an Gewinnern ein, mindestens 1.",
  "wizard.winners.label": "Anzahl der Gewinner",
  "wizard.winners.help": "Das kannst du später ändern.",
  "review.winners": "Gewinner",
  "verify.check.timing.match":
    "Die drand-Runde wurde veröffentlicht, nachdem die Liste festgeschrieben war.",
  "verify.check.timing.mismatch":
    "Die drand-Runde wurde veröffentlicht, bevor die Liste festgeschrieben war, daher ist der Ziehung nicht zu trauen.",
  "verify.facts.winners": "Geplante Gewinner",
  "verify.facts.committed": "Liste festgeschrieben am",
  "verify.rerolls.note": "Neuziehungen und zusätzliche Ziehungen stehen hier.",
  "verify.rerolls.count": "Neu gezogene Plätze: {count}.",
  "verify.winner.before": "{count} neu gezogene Plätze kamen davor.",
  "verify.mine.title": "Deine Teilnahme",
  "verify.mine.signedOut":
    "Melde dich auf der Gewinnspielseite mit dem Konto an, mit dem du mitgemacht hast, um deine eigene Teilnahme zu prüfen.",
  "verify.mine.chatOnly":
    "Bei einem YouTube-Gewinnspiel macht man im Chat ohne Anmeldung mit, daher kann diese Seite deine eigene Teilnahme und ihr privates Salt nicht zeigen. Die Prüfungen oben belegen trotzdem, dass die Ziehung fair war.",
  "verify.mine.hint":
    "Deine Teilnahme wird aus diesen Werten und deinem privaten Salt gehasht. Teil das Salt nicht.",
  "verify.mine.platform": "Plattform",
  "verify.mine.user": "Benutzer-ID",
  "verify.mine.salt": "Salt (privat)",
  "verify.mine.noSalt":
    "Deine Teilnahme hat noch kein Salt. Sie bekommt eins, wenn die Teilnahme endet. Lade später neu.",
  "verify.mine.found": "Deine Teilnahme ist Eintrag {leaf} der Liste, mit {tickets} Tickets.",
  "verify.mine.won": "Du bist Ziehung {n}.",
  "verify.mine.missing": "Deine Teilnahme ist nicht in der Liste.",
  "nav.draw": "Aus einer Liste ziehen",
  "draw.title": "Aus einer Liste ziehen",
  "draw.intro":
    "Füg Namen ein, schreib die Liste fest, und eine öffentliche drand-Runde zieht die Gewinner. Jeder mit dem Link kann die Ziehung in seinem eigenen Browser prüfen. Keine Anmeldung.",
  "draw.form.title": "Titel (optional)",
  "draw.form.titleTooLong": "Halte den Titel bei höchstens {max} Zeichen.",
  "draw.form.names": "Namen",
  "draw.form.namesHelp": "Ein Name pro Zeile, bis zu {max}. Ein doppelter Name zählt einmal.",
  "draw.form.count": "Namen: {count}. Doppelte ausgelassen: {repeats}.",
  "draw.form.empty": "Füg mindestens einen Namen hinzu.",
  "draw.form.tooMany": "Die Liste ist zu lang. Das Limit sind {max} Namen.",
  "draw.form.winners": "Gewinner",
  "draw.form.winnersInvalid": "Wähl 1 bis {max} Gewinner.",
  "draw.commit": "Liste festschreiben",
  "draw.badLink": "Dieser Ziehungslink ist kaputt oder unvollständig.",
  "draw.file.label": "Listendatei",
  "draw.file.help":
    "Die Liste war zu lang für den Link. Öffne die Listendatei, die dazu mitgeschickt wurde.",
  "draw.file.invalid": "Das ist keine Listendatei.",
  "draw.mismatch":
    "Die Namen passen nicht zum Listen-Hash. Der Link oder die Datei wurde verändert, deshalb wird nichts gezogen.",
  "draw.facts.names": "Namen",
  "draw.facts.winners": "Gewinner",
  "draw.facts.hash": "Listen-Hash",
  "draw.facts.roundAt": "Runde veröffentlicht am",
  "draw.facts.committed":
    "Liste festgeschrieben am (Uhr des Browsers, der sie festgeschrieben hat)",
  "draw.early":
    "Laut dieser Liste wurde sie festgeschrieben, nachdem die drand-Runde {round} veröffentlicht war, daher ist der Ziehung nicht zu trauen.",
  "draw.seenBefore":
    "Du hast diese Liste geöffnet, bevor die drand-Runde {round} veröffentlicht wurde, sie war also festgeschrieben, bevor jemand die Gewinner kennen konnte.",
  "draw.waiting": "Die Gewinner werden gezogen, sobald die drand-Runde {round} veröffentlicht ist.",
  "draw.drawn":
    "Die Gewinner ergeben sich aus der Liste und der Zufallszahl der drand-Runde {round}.",
  "draw.invalid":
    "Die Signatur der drand-Runde {round} ist ungültig, daher werden keine Gewinner gezeigt.",
  "draw.unavailable":
    "Die drand-Runde {round} konnte nicht gelesen werden. Versuch es später noch mal.",
  "draw.retry": "Noch mal versuchen",
  "draw.share.label": "Link zum Teilen",
  "draw.share.copy": "Link zum Teilen kopieren",
  "draw.share.withNames":
    "Der Link enthält die Namen. Wer ihn öffnet, sieht sie und bekommt dieselben Gewinner.",
  "draw.share.noNames":
    "Die Liste ist zu lang für einen Link. Teil den Link zusammen mit der Listendatei.",
  "draw.download": "Listendatei herunterladen",
  "draw.new": "Neue Ziehung",
  "draw.proof.title": "Was das beweist",
  "draw.proof.covers":
    "Die Gewinner ergeben sich aus genau diesen Namen und der Zufallszahl der drand-Runde. Jeder kann sie nachrechnen, und niemand kennt diese Zahl, bevor die Runde veröffentlicht ist.",
  "draw.proof.private":
    "Die Namen bleiben in deinem Browser. Sie verlassen ihn nur im Link oder in der Datei, die du teilst.",
  "draw.proof.time":
    "Die Zeit, zu der die Liste festgeschrieben wurde, kommt vom Browser, der sie festgeschrieben hat, nicht von einem Server. Jemand könnte eine Liste nach der Runde festschreiben und eine frühere Zeit behaupten. Trau der Ziehung nur, wenn du den Listen-Hash oder den Link gesehen hast, bevor die Runde veröffentlicht wurde.",
  "draw.proof.list": "Die Ziehung zeigt nicht, wer auf die Liste gehört. Prüf die Namen selbst.",
  "live.mod.link": "Moderatorenlinks",
  "live.mod.text":
    "Wer einen Link öffnet, kann bei diesem Gewinnspiel die Teilnahme beenden, ziehen, neu ziehen und Abholungen markieren. Die Person kann weder die Regeln ändern noch das Gewinnspiel löschen oder dein Konto sehen.",
  "live.mod.who": "Wer ihn nutzen darf",
  "live.mod.who.mods": "Moderatoren meines Kanals",
  "live.mod.who.mods.help":
    "Sie melden sich mit Twitch an und Rafflink prüft, ob sie deinen Kanal moderieren.",
  "live.mod.reconnect": "Links nur für Moderatoren brauchen noch eine Twitch-Berechtigung.",
  "live.rolesPaused": "Lose für VIPs und Moderatoren pausiert. Verbinde Twitch neu.",
  "live.mod.who.anyone": "Jeder mit dem Link",
  "live.mod.create": "Link erstellen",
  "live.mod.new": "Neuer Link. Kopier ihn jetzt, er wird nur einmal gezeigt.",
  "live.mod.copy": "Moderatorenlink kopieren",
  "live.mod.none": "Gerade funktioniert kein Moderatorenlink.",
  "live.mod.item": "Link {id}, erstellt um {time}",
  "live.mod.itemMod": "nur Moderatoren",
  "live.mod.revoke": "Widerrufen",
  "live.mod.revokeLabel": "Link {id} widerrufen",
  "live.mod.loadFailed": "Die Links konnten nicht geladen werden. Versuch es noch mal.",
  "modResult.revoked": "Link widerrufen. Er funktioniert nicht mehr.",
  "modResult.rejected": "Der Link wurde nicht geändert. Versuch es noch mal.",
  "live.actors.title": "Wer was gemacht hat",
  "live.actors.closed": "Teilnahme beendet von {who}",
  "live.actors.drawn": "Gewinner {n} gezogen von {who}",
  "live.actors.rerolled": "Gewinner {n} ersetzt von {who}",
  "live.actors.marked": "Gewinner {n} von {who} als abgeholt markiert",
  "live.actors.streamer": "dem Streamer",
  "live.actors.moderator": "Moderatorenlink {id}",
  "mod.invalid.title": "Dieser Moderatorenlink funktioniert nicht",
  "mod.invalid.text":
    "Der Streamer hat ihn widerrufen, oder er wurde falsch kopiert. Bitte den Streamer um einen neuen Link.",
  "mod.notMod.title": "Nur für Moderatoren",
  "mod.notMod.text":
    "Dieser Link ist für Moderatoren des Kanals des Streamers, und das Twitch-Konto, mit dem du angemeldet bist, ist keiner.",
  "mod.signInAgain":
    "Die Twitch-Anmeldung wurde nicht abgeschlossen. Öffne den Link vom Streamer noch einmal.",
  "mod.rateLimited":
    "Zu viele Versuche aus deinem Netzwerk. Warte eine Minute und öffne den Link noch einmal.",
  "signIn.why.moderator":
    "Dieser Moderatorenlink ist für Moderatoren des Kanals. Melde dich mit Twitch an, damit Rafflink prüfen kann, ob du einer bist.",
}
