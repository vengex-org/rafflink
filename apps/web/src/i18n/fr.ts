import type { Translation } from "./en.ts"

export const fr: Translation = {
  "nav.main": "Navigation principale",
  "nav.skip": "Aller au contenu",
  "nav.myGiveaways": "Mes giveaways",
  "nav.settings": "Paramètres",
  "nav.admin": "Administration",
  "nav.selfHost": "Auto-hébergement",
  "nav.verify": "Vérifier un tirage",
  "nav.github": "GitHub",
  "link.newTab": "S'ouvre dans un nouvel onglet",
  "nav.login": "Se connecter",
  "nav.logout": "Se déconnecter",
  "nav.streamerLogin": "Connexion streamer",
  "nav.support": "Soutenir Rafflink",
  "nav.loggedOut": "Tu es déconnecté.",
  "theme.legend": "Thème",
  "theme.system": "Système",
  "theme.light": "Clair",
  "theme.dark": "Sombre",
  "language.legend": "Langue",
  "language.loadFailed": "Impossible de charger cette langue. Réessaie.",
  "settings.label": "Paramètres d'affichage",

  "common.loading": "Chargement…",
  "common.cancel": "Annuler",
  "common.dismiss": "Fermer",
  "common.back": "Retour",
  "common.next": "Suivant",
  "common.optional": "facultatif",
  "info.about": "À propos : {topic}",
  "common.reloadPage": "Recharger la page",
  "action.failed": "Une erreur s'est produite. Réessaie.",

  "failed.title": "Une erreur s'est produite",
  "failed.text": "Une erreur s'est produite. Recharge la page.",
  "notFound.hint": "Vérifie le lien et réessaie.",
  "notFound.home": "Aller à l'accueil",
  "notFound.page": "Page introuvable",
  "notFound.giveaway": "Giveaway introuvable",
  "notFound.live": "Page live introuvable",
  "notFound.generic": "Introuvable",
  "notFound.history": "Ce streamer n'a pas d'historique public de giveaways",

  "signIn.title": "Connexion",
  "signIn.button": "Se connecter avec Twitch",
  "signIn.buttonKick": "Se connecter avec Kick",
  "signIn.buttonYouTube": "Se connecter avec YouTube",
  "signIn.why.admin": "Connecte-toi avec Twitch pour ouvrir la page d'administration.",
  "signIn.why.expired": "Ta session a expiré. Connecte-toi pour continuer.",
  "signIn.why.live": "Connecte-toi pour ouvrir la page live de ton giveaway.",

  "home.title": "Des giveaways équitables, tirés en direct sur ton stream.",
  "home.text": "Tes viewers participent en un clic et tu tires au sort devant ton chat.",
  "home.login": "Se connecter et commencer",
  "home.stage.toClaim": "pour réclamer",
  "home.reads": "Nous lisons uniquement ton nom et ton chat.",
  "home.worksWith": "Fonctionne avec",
  "home.trust.supportKoFi": "Soutenir sur Ko-fi",
  "home.trust.support": "Soutenir Rafflink",
  "home.footer.guide": "Guide d'auto-hébergement",
  "home.footer.label": "Pied de page",
  "home.problemTitle": "La connexion n'a pas fonctionné",
  "home.problem.invalidState": "La connexion a expiré. Réessaie.",
  "home.problem.noChannel":
    "Ce compte Google n'a pas de chaîne YouTube. Connecte-toi avec le compte propriétaire de ta chaîne.",
  "home.problem.tryAgain": "La plateforme de streaming n'a pas répondu. Réessaie.",

  "oauthError.title": "La connexion avec {platform} a échoué",
  "oauthError.access_denied": "Tu as annulé la connexion avec {platform}.",
  "oauthError.redirect_mismatch":
    "Cette installation de Rafflink n'est pas correctement configurée dans les paramètres développeur de {platform}. L'opérateur doit ajouter les URL de redirection.",
  "oauthError.setupLink": "Voir les étapes de configuration de l'application {platform}",
  "oauthError.generic": "{platform} n'a pas pu te connecter.",
  "oauthError.code": "Code d'erreur : {code}",
  "oauthError.tryAgain": "Réessayer",
  "oauthError.dismiss": "Fermer",

  "admin.title": "Administration",
  "admin.only.title": "Réservé aux admins",
  "admin.only.text": "Ce compte Twitch n'est pas admin.",
  "admin.usage.title": "Utilisation du jour",
  "admin.noLimit": "Ce serveur n'a pas de limite quotidienne de requêtes.",
  "admin.unavailable": "L'utilisation du jour n'est pas disponible pour le moment.",
  "admin.workerRequests": "Requêtes Worker",
  "admin.doRequests": "Requêtes Durable Object",
  "admin.usageText": "{used} requêtes sur {limit} utilisées aujourd'hui",
  "admin.queue.title": "File d'entrée",
  "admin.queue.hint":
    "Les participations attendent ici quand beaucoup de viewers se connectent en même temps.",
  "admin.queue.waiting": "participations en attente",
  "admin.queue.rate": "participations admises par seconde",
  "admin.queue.dropped": "participations abandonnées",
  "admin.queue.abandoned": "résultats que personne n'a récupérés",
  "admin.queue.lostClaims": "participations traitées deux fois, un résultat écarté",
  "admin.queue.cooldown": "Pause Twitch jusqu'à",
  "admin.queue.noCooldown": "aucune",
  "admin.usageNoLimit": "{used} requêtes aujourd'hui, pas de limite quotidienne",
  "admin.alert.title": "La limite du jour approche",
  "admin.alert.workerRequests": "Les requêtes Worker atteignent {percent} % de la limite du jour.",
  "admin.alert.doRequests":
    "Les requêtes Durable Object atteignent {percent} % de la limite du jour.",
  "admin.youtube.title": "Quota YouTube",
  "admin.youtube.hint":
    "Chaque appel à l'API YouTube compte dans le quota quotidien de Google, remis à zéro à minuit, heure du Pacifique. Quand il est épuisé, les giveaways YouTube arrêtent de lire le chat.",
  "admin.youtube.units": "Unités YouTube aujourd'hui",
  "admin.youtube.usageText": "{used} unités sur {limit} utilisées aujourd'hui",
  "admin.youtube.alert":
    "Les unités YouTube du jour atteignent {percent} % de la limite quotidienne. Demande plus de quota à Google avant que les giveaways YouTube arrêtent de lire le chat.",
  "admin.alert.hint":
    "Si la charge continue d'augmenter, souscris à Workers Paid dans le tableau de bord Cloudflare, puis passe le forfait sur Paid ci-dessous.",
  "admin.plan.title": "Forfait Cloudflare",
  "admin.plan.hint":
    "Souscris d'abord à Workers Paid dans le tableau de bord Cloudflare, puis change de forfait.",
  "admin.plan.link": "Forfaits Cloudflare",
  "admin.plan.free": "Free",
  "admin.plan.paid": "Paid",
  "admin.plan.paid.question": "Passer à Paid ?",
  "admin.plan.paid.detail":
    "Seulement une fois que tu as payé Workers Paid. L'application supprime alors les limites quotidiennes et la file d'entrée accepte beaucoup plus de participations à la fois.",
  "admin.plan.paid.confirm": "Passer à Paid",
  "admin.plan.free.question": "Revenir à Free ?",
  "admin.plan.free.detail":
    "L'application revient aux limites quotidiennes de Free et la file d'entrée n'accepte que quelques participations à la fois.",
  "admin.plan.free.confirm": "Passer à Free",
  "admin.plan.switched": "Forfait changé.",
  "admin.plan.failed": "Le forfait n'a pas été changé. Réessaie.",
  "admin.plan.queueUnavailable":
    "Le forfait est enregistré, mais la file ne l'a pas encore pris en compte. Change à nouveau pour réessayer.",
  "admin.access.title": "Accès des streamers",
  "admin.access.hint":
    "Les inscriptions sont fermées sur ce site. Les streamers peuvent se connecter, mais ils ne peuvent créer des giveaways qu'après ton approbation.",
  "admin.access.pending": "En attente d'approbation",
  "admin.access.approved": "Approuvés",
  "admin.access.nonePending": "Personne n'attend.",
  "admin.access.noneApproved": "Aucun streamer n'est encore approuvé.",
  "admin.access.truncated":
    "Il y a plus de streamers que ceux affichés. Les plus récents sont affichés.",
  "admin.access.firstLogin": "Première connexion le {date}",
  "admin.access.approve": "Approuver",
  "admin.access.approve.label": "Approuver {name}",
  "admin.access.revoke": "Révoquer",
  "admin.access.revoke.label": "Révoquer {name}",
  "admin.access.approvedDone": "Approuvé.",
  "admin.access.revokedDone": "Approbation révoquée.",
  "admin.access.failed": "La modification n'a pas abouti. Recharge la page et réessaie.",
  "admin.access.loadFailed": "Impossible de charger les listes de streamers.",
  "admin.limits.overridden": "défini dans l'env",
  "admin.limits.title": "Limites actives",
  "admin.limits.workerPerDay": "Requêtes Worker par jour",
  "admin.limits.doPerDay": "Requêtes Durable Object par jour",
  "admin.limits.workerPerMonth": "Requêtes Worker incluses par mois",
  "admin.limits.doPerMonth": "Requêtes Durable Object incluses par mois",
  "admin.limits.subrequests": "Sous-requêtes par appel de la file d'entrée",
  "admin.limits.none": "pas de limite quotidienne",
  "admin.live.updated": "Mis à jour à {time}",
  "admin.live.failed": "Impossible de charger les chiffres en direct. Nouvelle tentative.",
  "admin.live.title": "En ce moment",
  "admin.live.openGiveaways": "giveaways ouverts",
  "admin.live.viewers": "viewers connectés",
  "admin.live.entriesMinute": "participations dans la dernière minute",
  "admin.live.claimsMinute": "réclamations dans la dernière minute",
  "admin.live.rateLimitedHour": "réponses 429 de Twitch dans la dernière heure",
  "admin.live.partial":
    "Les viewers, participations et réclamations couvrent les {shown} plus récents des {total} giveaways ouverts.",
  "admin.presence.title": "Sur le site maintenant",
  "admin.presence.hint":
    "Onglets ouverts selon la page affichée. Les overlays OBS et les pages live ne comptent pas.",
  "admin.presence.total": "personnes sur le site",
  "admin.presence.home": "page d'accueil",
  "admin.presence.legal": "conditions et confidentialité",
  "admin.presence.dashboard": "tableau de bord et admin",
  "admin.presence.giveaway": "pages de giveaways",
  "admin.presence.other": "autres pages",
  "admin.presence.unavailable":
    "Le nombre de personnes sur le site n'est pas disponible pour l'instant.",
  "admin.giveaways.title": "Giveaways ouverts",
  "admin.giveaways.none": "Aucun giveaway n'est ouvert.",
  "admin.giveaways.streamer": "Streamer",
  "admin.giveaways.giveaway": "Giveaway",
  "admin.giveaways.viewers": "Viewers",
  "admin.giveaways.entries": "Participations",
  "admin.giveaways.ends": "Fin",
  "admin.giveaways.noEnd": "quand le streamer le ferme",
  "admin.hour.title": "Dernière heure",
  "admin.hour.hint":
    "Participations et réclamations par minute, comptées par les salles des giveaways. Une minute s'affiche une fois terminée.",
  "admin.hour.entries": "Participations",
  "admin.hour.claims": "Réclamations",
  "admin.hour.rateLimited": "429 Twitch",
  "admin.hour.label":
    "{entries} participations et {claims} réclamations dans la dernière heure, {rateLimited} réponses 429 de Twitch",
  "admin.hour.peak": "Pic : {count} par minute",
  "admin.growth.title": "Croissance",
  "admin.growth.hint": "Par jour (UTC) sur les {days} derniers jours.",
  "admin.growth.giveaways": "Giveaways créés",
  "admin.growth.streamers": "Nouveaux streamers",
  "admin.growth.label":
    "{giveaways} giveaways et {streamers} nouveaux streamers sur les {days} derniers jours",
  "admin.growth.returning":
    "streamers avec un deuxième giveaway dans les {days} jours après le premier",
  "admin.growth.pending": "streamers en attente d'approbation",
  "admin.growth.approved": "streamers approuvés",
  "admin.growth.atLeast": "{count}+",
  "admin.refs.title": "D'où viennent les visiteurs",
  "admin.refs.hint":
    "Visites de la page d'accueil avec ?ref=label dans l'adresse sur les {days} derniers jours. Aucun cookie, aucune adresse, rien qui identifie un visiteur.",
  "admin.refs.none": "Aucune visite avec un label ref pour l'instant.",
  "admin.refs.source": "Source",
  "admin.refs.visits": "Visites",
  "admin.queue.rateLimited": "réponses 429 de Twitch",
  "admin.queue.lastRateLimited": "dernier 429 de Twitch",
  "admin.queue.never": "jamais",

  "stat.people": "personnes inscrites",
  "stat.perSecond": "participations par seconde",
  "entrants.none": "Personne n'a encore participé.",
  "entrants.title": "Participants",
  "entrants.search.label": "Rechercher par nom",
  "entrants.search.help":
    "Tape quelques lettres d'un nom ou d'un identifiant. Les majuscules n'ont pas d'importance.",
  "entrants.col.name": "Nom",
  "entrants.col.tickets": "Tickets",
  "entrants.col.status": "Statut",
  "entrants.col.actions": "Actions",
  "entrants.winner": "Gagnant {n}",
  "entrants.list.aria": "Personnes qui ont participé, fais défiler pour en voir plus",
  "entrants.loading.title": "Chargement de la liste",
  "entrants.loading.text":
    "Cela prend quelques secondes, même quand beaucoup de personnes ont participé.",
  "entrants.failed.title": "La liste ne s'est pas chargée",
  "entrants.failed.text":
    "Rafflink n'a pas pu charger la liste des participants. Ton giveaway n'est pas affecté.",
  "entrants.retry": "Réessayer",
  "entrants.empty.title": "La liste est vide",
  "entrants.empty.text": "Les participants apparaissent ici dès qu'ils s'inscrivent.",
  "entrants.noMatch.title": "Personne ne correspond à ta recherche",
  "entrants.noMatch.text": "Vérifie l'orthographe ou tape moins de lettres.",
  "entrants.clear": "Effacer la recherche",
  "entrants.search.placeholder": "Trouver un participant",
  "entrants.tiers": "Participants par niveau",
  "entrants.showing": "{shown} affichés sur {total}",
  "entrants.sort": "Gagnants d'abord, puis les plus récents",
  "entrants.status.claimed": "Réclamé",
  "entrants.status.rerolled": "Remplacé",
  "entrants.status.expired": "Pas réclamé",
  "tier.viewer": "Viewer",
  "tier.follower": "Follower",
  "tier.sub_t1": "Tier 1",
  "tier.sub_t2": "Tier 2",
  "tier.sub_t3": "Tier 3",
  "tier.member": "Membre",
  "tier.vip": "VIP",
  "tier.moderator": "Modo",
  "overlay.enterAt": "Participe sur",
  "overlay.qr": "QR code avec le lien pour participer au giveaway",
  "overlay.winners": "Gagnants",
  "overlay.moreWinners": "et {count} de plus",
  "giveaway.fallbackName": "Giveaway {code}",

  "status.open": "Participations ouvertes",
  "status.closed": "Participations fermées",
  "status.drawn": "Gagnants tirés",
  "winner.removed": "(participation supprimée)",
  "claim.claimed.rafflink": "Réclamé sur Rafflink",
  "claim.claimed.chat": "Réclamé dans le chat",
  "claim.claimed.manual": "Réclamé manuellement",
  "claim.at": "{label} le {at}",
  "claim.waiting": "En attente de réclamation",
  "claim.expired": "Le délai de réclamation est écoulé",
  "claim.rerolled": "Pas réclamé, remplacé",
  "claim.tone.info": "restant pour réclamer",
  "claim.tone.warning": "restant, dépêche-toi",
  "claim.tone.danger": "restant, réclame maintenant",

  "reason.broadcaster": "Le streamer ne peut pas participer à son propre giveaway.",
  "reason.subs-only": "Ce giveaway est réservé aux abonnés.",
  "reason.followers-only": "Ce giveaway est réservé aux followers.",
  "reason.account-too-young": "Ton compte Twitch est trop récent pour ce giveaway.",
  "reason.no-tickets": "Ton groupe ne reçoit aucun ticket dans ce giveaway.",
  "reason.page-entry-off":
    "Ce giveaway accepte les participations uniquement dans le chat du stream.",
  "reasonHelp.page-entry-off":
    "Tape le mot-clé affiché sur cette page dans le chat du stream pour participer.",
  "reasonHelp.broadcaster": "Connecte-toi avec un autre compte {platform} pour participer.",
  "entry.otherAccount": "Utiliser un autre compte {platform}",
  "reason.blocked": "Tu ne peux pas participer à ce giveaway.",
  "reasonHelp.blocked": "Si tu as des questions, demande au streamer.",
  "reason.recent-winner":
    "Tu as gagné l'un des derniers giveaways de ce streamer, tu ne peux donc pas participer à celui-ci.",
  "reasonHelp.recent-winner":
    "Tu pourras participer à nouveau quand ton gain ne fera plus partie de ses derniers giveaways.",
  "reasonHelp.subs-only": "Abonne-toi à la chaîne sur Twitch, puis rouvre ce lien.",
  "reasonHelp.followers-only": "Suis la chaîne sur Twitch, puis rouvre ce lien.",
  "reasonHelp.account-too-young":
    "Reviens quand ton compte sera plus ancien. Participer avec un autre compte ne servira à rien.",
  "reasonHelp.no-tickets":
    "Le streamer n'a donné aucun ticket à ton groupe, tu ne peux donc pas gagner celui-ci.",

  "group.viewer": "Viewers",
  "group.follower": "Followers",
  "group.sub_t1": "Abonnés, tier 1",
  "group.sub_t2": "Abonnés, tier 2",
  "group.sub_t3": "Abonnés, tier 3",
  "group.member": "Membres de la chaîne",
  "group.vip": "VIP",
  "group.moderator": "Modérateurs",

  "viewerClaim.claimed": "Réclamé ! Le streamer va te contacter.",
  "viewerClaim.already-claimed": "Ce lot a déjà été réclamé.",
  "viewerClaim.expired": "Le délai de réclamation est écoulé.",
  "viewerClaim.rerolled": "Le streamer a choisi un autre gagnant.",
  "viewerClaim.not-a-winner": "Tu n'es pas gagnant de ce giveaway.",
  "viewerClaim.rejected":
    "Ta réclamation n'a pas abouti. Reconnecte-toi et appuie sur Réclamer mon lot.",

  "closeResult.closed": "Participations fermées.",
  "closeResult.not-open": "Les participations étaient déjà fermées.",
  "closeResult.rejected": "Impossible de fermer les participations. Recharge la page et réessaie.",
  "drawResult.entries-deleted":
    "Les participants ont déjà été supprimés après la durée de conservation, il n'est donc plus possible de tirer des gagnants.",
  "drawResult.rejected": "Impossible de tirer un gagnant.",
  "rerollResult.rerolled": "Un autre gagnant a été tiré.",
  "rerollResult.already-rerolled": "Un autre gagnant a déjà été tiré pour cette place.",
  "rerollResult.already-claimed": "Ce gagnant a déjà réclamé.",
  "rerollResult.unknown-pick": "Ce gagnant n'existe pas.",
  "rerollResult.not-drawn": "Tire d'abord les gagnants.",
  "rerollResult.no-entrants-left": "Il ne reste aucun participant à tirer.",
  "rerollResult.entries-deleted":
    "Les participants ont déjà été supprimés après la durée de conservation, il n'est donc plus possible de tirer un autre gagnant.",
  "rerollResult.reroll-window-over":
    "Le délai pour tirer un autre gagnant est écoulé. Contacte le gagnant toi-même ou lance un nouveau giveaway.",
  "rerollResult.try-again": "Ça n'a pas marché. Réessaie.",
  "rerollResult.rejected": "Impossible de tirer un autre gagnant.",
  "markResult.claimed": "Marqué comme réclamé.",
  "markResult.already-claimed": "Ce gagnant a déjà réclamé.",
  "markResult.expired": "Le délai de réclamation est écoulé.",
  "markResult.rerolled": "Ce gagnant a été remplacé par un autre.",
  "markResult.not-a-winner": "Ce gagnant n'existe pas.",
  "markResult.rejected": "Impossible de marquer la réclamation.",

  "issue.not-an-object": "Requête invalide.",
  "issue.missing": "Ce champ est obligatoire.",
  "issue.not-a-boolean": "Valeur invalide.",
  "issue.not-a-string": "Saisis du texte.",
  "issue.not-a-non-negative-integer": "Saisis un nombre entier, 0 ou plus.",
  "issue.not-a-positive-integer": "Saisis un nombre entier, 1 ou plus.",
  "issue.blank": "Ce champ ne peut pas être vide.",
  "issue.too-long": "C'est trop long. Raccourcis-le.",
  "issue.too-large": "Ce nombre est trop grand. Saisis-en un plus petit.",
  "issue.no-entry-way":
    "Les viewers ont besoin d'un moyen de participer : la page, le chat ou les deux.",
  "issue.reconnect":
    "Reconnecte d'abord Twitch : la participation par sub et par points de chaîne nécessite une autorisation que Rafflink n'a pas encore.",
  "issue.youtubeQuota":
    "Les unités YouTube qui restent aujourd'hui ne suffisent pas pour lire le chat jusqu'à la fin des participations. Ferme les participations plus tôt ou réessaie après minuit, heure du Pacifique.",
  "issue.not-a-timestamp": "Saisis une date et une heure valides.",
  "issue.in-the-past": "L'heure de fin doit être dans le futur.",
  "issue.unknown-kind": "Choisis l'une des options.",
  "issue.unsupported": "Ta plateforme de streaming ne peut pas vérifier cette règle. Désactive-la.",
  "issue.not-a-list": "Valeur invalide.",
  "issue.duplicate": "Chaque option ne peut être choisie qu'une fois.",
  "issue.wholeDays": "Saisis un nombre entier de jours, ou laisse le champ vide.",
  "issue.wholeMinutes": "Saisis un nombre entier de minutes, 1 ou plus.",
  "issue.pickEnd": "Choisis la date et l'heure de fin des participations.",
  "issue.future": "Choisis une heure dans le futur.",
  "issue.wholeYears": "Saisis un nombre entier d'années de 1 à 99, ou laisse le champ vide.",

  "ticket.one": "{count} ticket",
  "ticket.few": "{count} tickets",
  "ticket.other": "{count} tickets",
  "ticket.many": "{count} de tickets",
  "drawBatch.one": "Tirer {count} gagnant",
  "drawBatch.few": "Tirer {count} gagnants",
  "drawBatch.other": "Tirer {count} gagnants",
  "drawBatch.many": "Tirer {count} de gagnants",
  "winners.one": "{count} gagnant",
  "winners.few": "{count} gagnants",
  "winners.other": "{count} gagnants",
  "winners.many": "{count} de gagnants",
  "minute.one": "{count} minute",
  "minute.few": "{count} minutes",
  "minute.other": "{count} minutes",
  "minute.many": "{count} de minutes",
  "day.one": "{count} jour",
  "day.few": "{count} jours",
  "day.other": "{count} jours",
  "day.many": "{count} de jours",
  "year.one": "{count} an",
  "year.few": "{count} ans",
  "year.other": "{count} ans",
  "year.many": "{count} d'années",
  "recentGiveaways.one": "Les gagnants du dernier giveaway de {name} ne peuvent pas participer.",
  "recentGiveaways.few":
    "Les gagnants des {count} derniers giveaways de {name} ne peuvent pas participer.",
  "recentGiveaways.other":
    "Les gagnants des {count} derniers giveaways de {name} ne peuvent pas participer.",
  "recentGiveaways.many":
    "Les gagnants des {count} derniers giveaways de {name} ne peuvent pas participer.",
  "recentDays.one":
    "Les gagnants des giveaways de {name} du dernier jour ne peuvent pas participer.",
  "recentDays.few":
    "Les gagnants des giveaways de {name} des {count} derniers jours ne peuvent pas participer.",
  "recentDays.other":
    "Les gagnants des giveaways de {name} des {count} derniers jours ne peuvent pas participer.",
  "recentDays.many":
    "Les gagnants des giveaways de {name} des {count} derniers jours ne peuvent pas participer.",
  "recentGiveawaysOwn.one": "Les gagnants de ton dernier giveaway ne peuvent pas participer.",
  "recentGiveawaysOwn.few":
    "Les gagnants de tes {count} derniers giveaways ne peuvent pas participer.",
  "recentGiveawaysOwn.other":
    "Les gagnants de tes {count} derniers giveaways ne peuvent pas participer.",
  "recentGiveawaysOwn.many":
    "Les gagnants de tes {count} derniers giveaways ne peuvent pas participer.",
  "recentDaysOwn.one": "Les gagnants de tes giveaways du dernier jour ne peuvent pas participer.",
  "recentDaysOwn.few":
    "Les gagnants de tes giveaways des {count} derniers jours ne peuvent pas participer.",
  "recentDaysOwn.other":
    "Les gagnants de tes giveaways des {count} derniers jours ne peuvent pas participer.",
  "recentDaysOwn.many":
    "Les gagnants de tes giveaways des {count} derniers jours ne peuvent pas participer.",
  "recentGiveawaysShort.one": "sans les gagnants du dernier giveaway",
  "recentGiveawaysShort.few": "sans les gagnants des {count} derniers giveaways",
  "recentGiveawaysShort.other": "sans les gagnants des {count} derniers giveaways",
  "recentGiveawaysShort.many": "sans les gagnants des {count} derniers giveaways",
  "recentDaysShort.one": "sans les gagnants du dernier jour",
  "recentDaysShort.few": "sans les gagnants des {count} derniers jours",
  "recentDaysShort.other": "sans les gagnants des {count} derniers jours",
  "recentDaysShort.many": "sans les gagnants des {count} derniers jours",
  "entered.one": "{count} personne inscrite",
  "entered.few": "{count} personnes inscrites",
  "entered.other": "{count} personnes inscrites",
  "entered.many": "{count} de personnes inscrites",
  "usageLow.one":
    "Attention : il ne reste au serveur que {count} requête pour aujourd'hui. Les participations peuvent cesser de fonctionner une fois épuisées.",
  "usageLow.few":
    "Attention : il ne reste au serveur que {count} requêtes pour aujourd'hui. Les participations peuvent cesser de fonctionner une fois épuisées.",
  "usageLow.other":
    "Attention : il ne reste au serveur que {count} requêtes pour aujourd'hui. Les participations peuvent cesser de fonctionner une fois épuisées.",
  "usageLow.many":
    "Attention : il ne reste au serveur que {count} de requêtes pour aujourd'hui. Les participations peuvent cesser de fonctionner une fois épuisées.",
  "roleFailures.one":
    "Une fois, Rafflink n'a pas pu charger tes listes de VIP et de modérateurs depuis Twitch. Il se peut que ces viewers n'aient pas reçu leurs tickets supplémentaires.",
  "roleFailures.few":
    "{count} fois, Rafflink n'a pas pu charger tes listes de VIP et de modérateurs depuis Twitch. Il se peut que ces viewers n'aient pas reçu leurs tickets supplémentaires.",
  "roleFailures.other":
    "{count} fois, Rafflink n'a pas pu charger tes listes de VIP et de modérateurs depuis Twitch. Il se peut que ces viewers n'aient pas reçu leurs tickets supplémentaires.",
  "roleFailures.many":
    "{count} de fois, Rafflink n'a pas pu charger tes listes de VIP et de modérateurs depuis Twitch. Il se peut que ces viewers n'aient pas reçu leurs tickets supplémentaires.",
  "chatFailures.one":
    "Une fois, Rafflink a perdu la connexion à ton chat. La surveillance du chat a pu manquer des messages.",
  "chatFailures.few":
    "{count} fois, Rafflink a perdu la connexion à ton chat. La surveillance du chat a pu manquer des messages.",
  "chatFailures.other":
    "{count} fois, Rafflink a perdu la connexion à ton chat. La surveillance du chat a pu manquer des messages.",
  "chatFailures.many":
    "{count} de fois, Rafflink a perdu la connexion à ton chat. La surveillance du chat a pu manquer des messages.",

  "who.both": "Seuls les abonnés qui suivent la chaîne peuvent participer.",
  "who.subs": "Seuls les abonnés peuvent participer.",
  "who.followers": "Seuls les followers peuvent participer.",
  "who.everyone": "Tout le monde peut participer.",
  "who.ticketGroups": "Seuls les groupes qui reçoivent des tickets peuvent participer.",
  "whoShort.both": "Abonnés qui suivent",
  "whoShort.subs": "Abonnés uniquement",
  "whoShort.followers": "Followers uniquement",
  "whoShort.everyone": "Tout le monde",
  "whoShort.ticketGroups": "Groupes avec tickets uniquement",
  "extraTicketsShort.subs": "les abonnés reçoivent {tickets}",
  "extraTicketsShort.some": "tickets bonus pour certains",
  "ticket.cannotEnter": "ne peut pas participer",
  "claimTime.clock": "{clock} minutes",

  "step.of": "Étape {current} sur {total} : {name}",
  "step.allDone": "Les {total} étapes sont terminées",
  "step.list": "Étapes",
  "step.go": "Étape {number} : {name}",
  "winners.fewer": "Moins de gagnants",
  "winners.more": "Plus de gagnants",

  "giveaway.stepSignIn": "Se connecter",
  "giveaway.stepTicket": "Obtenir ton ticket",
  "giveaway.phase.open": "Participations ouvertes",
  "giveaway.phase.closed": "Participations fermées",
  "giveaway.phase.drawn": "Gagnants tirés",
  "giveaway.row.who": "Qui peut participer",
  "giveaway.row.entries": "Participations",
  "giveaway.row.pool": "Tiré parmi",
  "giveaway.row.code": "Code",
  "giveaway.watch": "Regarder {name} sur Twitch",
  "giveaway.openUntilClosed":
    "Les participations restent ouvertes jusqu'à ce que le streamer les ferme.",
  "giveaway.aboutToClose": "Les participations vont bientôt fermer.",
  "giveaway.closesIn": "Les participations ferment dans {time}.",
  "giveaway.drawn.title": "Les gagnants sont tirés",
  "giveaway.drawn.text": "Connecte-toi avec {platform} pour voir si tu as gagné.",
  "giveaway.notThisTime.title": "Pas cette fois",
  "giveaway.notThisTime.text": "Le gagnant a été tiré. Ce n'est pas toi cette fois.",
  "giveaway.ready.title": "Prêt à participer ?",
  "giveaway.ready.text":
    "Connecte-toi avec ton compte {platform} pour obtenir ton ticket. Ça prend quelques secondes.",
  "giveaway.enter": "Participer avec Twitch",
  "giveaway.enterKick": "Participer avec Kick",
  "giveaway.signedOut.title": "Connecte-toi pour participer",
  "giveaway.waiting.title": "En attente du tirage",
  "giveaway.waiting.text":
    "Les participations sont fermées. Le streamer tire le gagnant en direct. Garde cette page ouverte : elle passe d'elle-même à l'écran de réclamation si tu gagnes.",
  "giveaway.paused.title": "Participations en pause",
  "giveaway.paused.text":
    "Les giveaways {platform} sont en pause sur ce site pour le moment. Reviens plus tard.",
  "giveaway.closed.title": "Désolé, le giveaway est fermé.",
  "giveaway.closed.text":
    "Le streamer n'accepte plus de participations. Suis la chaîne pour ne pas rater le prochain.",
  "entry.in.title": "Tu participes",
  "entry.in.detail":
    "Le streamer tire le gagnant en direct. Garde cette page ouverte ou reviens plus tard.",
  "entry.in.help": "Bonne chance !",
  "entry.already.detail":
    "Ta première participation est conservée. Tu n'as pas besoin de participer à nouveau.",
  "entry.already.help":
    "Le streamer tire le gagnant en direct. Garde cette page ouverte ou reviens plus tard.",
  "entry.in.tickets": "Ta participation : {tickets} {role}.",
  "entry.role.viewer": "en tant que viewer",
  "entry.role.follower": "en tant que follower",
  "entry.role.sub_t1": "en tant qu'abonné tier 1",
  "entry.role.sub_t2": "en tant qu'abonné tier 2",
  "entry.role.sub_t3": "en tant qu'abonné tier 3",
  "entry.role.member": "en tant que membre de la chaîne",
  "entry.role.vip": "en tant que VIP",
  "entry.role.moderator": "en tant que modérateur",
  "entry.pending.title": "Ta participation est en cours",
  "entry.pending.detail": "Cela prend jusqu'à {wait}. Ne ferme pas cette page.",
  "entry.pending.help": "{platform} est occupé. Cette page se met à jour toute seule.",
  "entry.notEligible.title": "Tu ne peux pas participer",
  "entry.dropped.title": "Ta participation a pris trop de temps",
  "entry.dropped.detail":
    "Trop de personnes ont participé en même temps et ta participation a été abandonnée.",
  "entry.dropped.help": "Appuie sur le bouton pour participer à nouveau.",
  "entry.timedOut.title": "Ça prend trop de temps",
  "entry.timedOut.detail": "Nous n'avons pas reçu de réponse à temps.",
  "entry.timedOut.help": "Appuie sur le bouton pour participer à nouveau.",
  "entry.tryAgain.title": "Réessaie",
  "entry.tryAgain.detail": "{platform} n'a pas répondu à temps.",
  "entry.tryAgain.help": "Appuie sur le bouton pour retenter ta chance.",
  "entry.rateLimited.title": "Trop de tentatives",
  "entry.rateLimited.detail": "Tu as essayé de participer trop souvent en peu de temps.",
  "entry.rateLimited.help": "Attends une minute, puis appuie sur le bouton pour réessayer.",
  "entry.invalidState.title": "Connexion expirée",
  "entry.invalidState.detail": "Ta connexion a pris trop de temps.",
  "entry.invalidState.help": "Appuie sur le bouton pour recommencer.",
  "win.another.title": "Un autre gagnant a été choisi",
  "win.title": "Tu as gagné",
  "win.claimed.title": "Lot réclamé",
  "win.claimedAt": "Réclamé le {at}. {name} va te contacter.",
  "win.contact": "{name} va te contacter.",
  "win.up.title": "Le temps est écoulé",
  "win.up.text": "Le streamer peut choisir un autre gagnant.",
  "win.press":
    "Réclame maintenant, sinon le streamer pourra choisir quelqu'un d'autre à la fin du compte à rebours.",
  "win.claim": "Réclamer mon lot",
  "win.orAny": "Ou écris n'importe quel message dans le chat du stream.",
  "win.orType": "Ou tape {keyword} dans le chat du stream.",

  "winnerField.name": "Nom",
  "winnerField.email": "E-mail",
  "winnerField.address": "Adresse de livraison",
  "winnerField.platform-id": "Compte de jeu ou identifiant de plateforme",
  "winnerField.text": "Message au streamer",
  "winnerForm.title": "Où envoyer le lot ?",
  "winnerForm.notice": "Seul {name} voit ceci. Supprimé après la livraison (30 jours max.).",
  "winnerForm.send": "Envoyer",
  "winnerForm.saved": "Tes réponses ont été envoyées au streamer.",
  "winnerForm.already-answered": "Tu as déjà envoyé tes réponses.",
  "winnerForm.not-claimed": "Réclame d'abord le lot.",
  "winnerForm.form-closed": "Le formulaire est fermé.",
  "winnerForm.not-a-winner": "Tu n'es pas gagnant de ce giveaway.",
  "winnerForm.rejected": "L'envoi n'a pas fonctionné. Réessaie.",
  "winnerForm.invalid": "Remplis tous les champs. L'e-mail doit contenir un @.",
  "answers.title": "Réponses des gagnants",
  "answers.none": "Aucun gagnant n'a encore réclamé.",
  "answers.pick": "Gagnant {n} : {name}",
  "answers.unnamed": "gagnant inconnu",
  "answers.waiting": "Pas encore envoyé.",
  "answers.deleted": "Les réponses ont été supprimées.",
  "answers.received": "Réponses reçues.",
  "answers.show": "Afficher les réponses",
  "answers.hide": "Masquer les réponses",
  "answers.confirm.title": "Afficher les réponses privées ?",
  "answers.confirm.text": "Vérifie que cette page n'apparaît pas sur ton stream.",
  "answers.confirm.show": "Afficher",
  "answers.closed": "Pas envoyé. Le formulaire est fermé.",
  "answers.delivered": "Livré le {at}.",
  "answers.markDelivered": "Marquer comme livré",
  "answers.deliverFailed": "Impossible de marquer le lot comme livré. Recharge la page.",
  "answers.failed": "Impossible de charger les réponses.",
  "answers.privacy": "Toi seul les vois. Supprimées à la livraison ou après 30 jours.",
  "rules.summary": "Règles et tickets",
  "rules.help": "Plus un groupe reçoit de tickets, plus ses chances de gagner sont grandes.",
  "rules.groupTickets": "{group} : {tickets}",
  "rules.accountAge": "Compte créé il y a au moins {days}",
  "rules.entriesEnd": "Les participations se terminent le {time}, ou plus tôt si {name} les ferme.",
  "rules.claimTime": "Les gagnants ont {time} pour réclamer.",
  "rules.claimWhere": "Un gagnant réclame sur cette page ou dans le chat du stream.",
  "rules.organizer": "Organisé par {name}. Rafflink n'est pas l'organisateur.",
  "rules.blocked": "Les comptes bloqués par {name} ne peuvent pas participer.",
  "rules.broadcaster": "{name} ne peut pas participer à son propre giveaway.",
  "rules.platform":
    "{platform} ne sponsorise pas, ne cautionne pas et n'organise pas ce giveaway, et n'y est pas associé.",
  "rules.prize": "Lot : {prize}",
  "rules.prizeNone": "Le lot n'est pas décrit ici. Demande à {name}.",
  "rules.enterPage": "Pour participer, connecte-toi avec {platform} sur cette page.",
  "rules.enterChat":
    "Pour participer, tape « {keyword} » dans le chat {platform} de {name} pendant que les participations sont ouvertes.",
  "rules.enterSub":
    "S'abonner à {name}, renouveler son abonnement ou recevoir un sub offert pendant que les participations sont ouvertes te fait aussi participer. Tu n'as jamais besoin de t'abonner pour participer.",
  "rules.enterPoints":
    "Échanger la récompense de points de chaîne « {reward} » pendant que les participations sont ouvertes te fait aussi participer une fois, sans tickets supplémentaires.",
  "rules.free":
    "La participation est gratuite. Tu n'as rien à acheter pour participer ni pour gagner.",
  "rules.paidOnly":
    "Seuls les abonnés peuvent participer, il n'existe donc aucun moyen gratuit de participer à ce giveaway.",
  "rules.minAge": "Les gagnants doivent avoir au moins {age}.",
  "rules.excludedCountries":
    "Les personnes qui vivent dans ces lieux ne peuvent pas gagner : {places}.",
  "rules.checkedByStreamer":
    "Rafflink ne peut vérifier ni l'âge ni le lieu de résidence. {name} peut le vérifier et refuser de remettre le lot.",
  "rules.entriesEndManual": "Les participations se terminent quand {name} les ferme.",
  "rules.draw":
    "Les gagnants sont tirés au hasard, pondérés par les tickets, à partir d'un nombre aléatoire public (drand) que personne ici ne contrôle.",
  "rules.verify": "Tout le monde peut vérifier le tirage sur {url}",
  "rules.claimLate":
    "Tant que le gagnant n'a pas réclamé le lot, {name} peut le remplacer par un nouveau tirage.",
  "rules.delivery": "{name} remet le lot. Rafflink ne détient ni n'envoie aucun lot.",
  "rules.winnerForm":
    "Après avoir réclamé, le gagnant remplit un court formulaire sur cette page pour la livraison ({fields}). Seul {name} voit les réponses. Elles sont supprimées quand le lot est livré, au plus tard 30 jours après la réclamation.",
  "rules.extraTerms": "Conditions supplémentaires de {name} :",
  "rules.notice":
    "Ces règles sont générées à partir des paramètres du giveaway. Ce sont un modèle, pas un conseil juridique.",
  "rules.copy": "Copier les règles en texte",
  "rules.copyHeading": "Règles du giveaway : {url}",

  "dash.title": "Mes giveaways",
  "dash.settings.title": "Paramètres",
  "dash.new.title": "Nouveau giveaway",
  "dash.new.button": "Nouveau giveaway",
  "dash.created.title": "Ton giveaway est en ligne !",
  "dash.roomNotReady":
    "Le giveaway n'est pas encore entièrement prêt. Ouvre la page live pour terminer la configuration.",
  "dash.next": "Partage ce lien dans ton chat.",
  "dash.openLive": "Ouvrir la page live",
  "dash.obs.title": "Ajouter à OBS (facultatif)",
  "dash.obs.text": "Affiche les participations sur ton stream pendant que les gens s'inscrivent.",
  "dash.obs.steps": "Comment l'ajouter dans OBS",
  "dash.back": "Retour à mes giveaways",
  "dash.access.title": "En attente d'approbation",
  "dash.access.text":
    "Tu es connecté, mais l'admin de ce site n'a pas encore autorisé ton compte à créer des giveaways. Demande à l'admin, puis recharge cette page.",
  "dash.support.text": "Si Rafflink t'a fait gagner du temps, tu peux le soutenir.",
  "dash.support.link": "Soutenir",
  "dash.empty.title": "Crée ton premier giveaway",
  "dash.empty.text": "Ça prend environ une minute. Voici comment ça marche.",
  "dash.empty.create.lead": "Crée-le.",
  "dash.empty.create.rest": "Indique ce que tu fais gagner et qui peut participer.",
  "dash.empty.share.lead": "Partage le lien.",
  "dash.empty.share.rest":
    "Colle-le dans ton chat. Les viewers se connectent sur la page du giveaway pour participer.",
  "dash.empty.draw.lead": "Tire en direct.",
  "dash.empty.draw.rest": "Ferme les participations et choisis le gagnant sur ton stream.",
  "dash.empty.button": "Créer un giveaway",
  "dash.prize": "Lot : {prize}",
  "dash.codeCreated": "Code {code}, créé le {date}",
  "dash.delivered": "{delivered} sur {claimed} livrés",
  "dash.linkObs": "Lien et overlay OBS",
  "dash.duplicate": "Dupliquer",
  "dash.duplicate.label": "Dupliquer {name}",
  "dash.section.running": "En cours",
  "dash.section.drawn": "Terminés",
  "dash.search.label": "Rechercher dans les giveaways terminés",
  "dash.search.placeholder": "Rechercher par nom, lot ou code",
  "dash.search.none": "Aucun giveaway terminé ne correspond à ta recherche.",
  "dash.csv": "Gagnants en CSV",
  "dash.csv.label": "Gagnants en CSV, {name}",
  "dash.delete": "Supprimer",
  "dash.delete.question": "Supprimer {name} ?",
  "dash.delete.detail":
    "Le giveaway, avec ses participants, ses gagnants et sa preuve de tirage, est supprimé définitivement, et son lien cesse de fonctionner.",
  "dash.delete.confirm": "Oui, le supprimer",
  "dash.deleteData.title": "Tes données",
  "dash.deleteData.text":
    "Tu peux supprimer tous les giveaways que tu as créés ainsi que ton compte Rafflink.",
  "dash.deleteData.button": "Supprimer toutes mes données",
  "dash.deleteData.question": "Supprimer toutes tes données ?",
  "dash.deleteData.detail":
    "Tous les giveaways avec leurs participants, gagnants et preuves de tirage, ton compte et ton jeton de connexion enregistré sont supprimés définitivement, et tu es déconnecté.",
  "dash.deleteData.confirm": "Oui, tout supprimer",
  "dash.blocks.title": "Comptes bloqués",
  "dash.blocks.text": "Les comptes bloqués ne peuvent pas participer à tes giveaways.",
  "dash.blocks.info":
    "Leurs participations aux giveaways ouverts sont supprimées ; celles des giveaways fermés restent. La liste est supprimée avec ton compte.",
  "dash.blocks.count": "{count} comptes bloqués sur {max}",
  "dash.blocks.none": "Aucun compte bloqué.",
  "dash.blocks.label": "Nom d'utilisateur à bloquer",
  "dash.blocks.add": "Bloquer",
  "dash.blocks.remove": "Retirer",
  "dash.blocks.remove.label": "Retirer {login} de la liste de blocage",
  "dash.blocks.since": "bloqué le {date}",
  "dash.blocks.added": "Compte bloqué.",
  "dash.blocks.exists": "Ce compte est déjà bloqué.",
  "dash.blocks.removed": "Compte retiré de la liste de blocage.",
  "dash.blocks.invalid-input": "Saisis un nom d'utilisateur.",
  "dash.blocks.unknown-login": "Aucun compte ne porte ce nom d'utilisateur.",
  "dash.blocks.block-list-full": "La liste de blocage est pleine. Retire d'abord un compte.",
  "dash.blocks.platform-unavailable":
    "La plateforme de streaming n'a pas répondu. Réessaie dans un instant.",
  "dash.blocks.room-unavailable":
    "Enregistré, mais un giveaway en cours n'a pas encore reçu la modification. Refais la même action.",
  "dash.history.title": "Historique public",
  "dash.history.text":
    "Affiche tes giveaways terminés sur une page publique. Sans nom de participant.",
  "dash.history.link": "Ouvrir ta page d'historique public",
  "dash.history.turnOn": "Activer l'historique public",
  "dash.history.turnOff": "Désactiver l'historique public",
  "dash.history.saved":
    "Enregistré. La page publique peut mettre quelques minutes à afficher la modification.",
  "dash.history.notIndexed": "Les moteurs de recherche n'indexent pas la page.",
  "dash.history.indexed":
    "Les moteurs de recherche peuvent indexer la page et l'afficher dans leurs résultats.",
  "dash.history.allowIndexing": "Autoriser l'indexation par les moteurs de recherche",
  "dash.history.stopIndexing": "Arrêter l'indexation par les moteurs de recherche",
  "dash.history.hide": "Masquer de l'historique",
  "dash.history.show": "Afficher dans l'historique",
  "dash.history.hide.label": "Masquer {name} de ton historique public",
  "dash.history.show.label": "Afficher {name} dans ton historique public",
  "history.title": "Giveaways de {name}",
  "history.intro":
    "Les giveaways terminés de ce streamer, du plus récent au plus ancien. Chaque tirage peut être vérifié sur sa page de vérification. Aucun participant ni aucun gagnant n'est nommé ici.",
  "history.none": "Aucun giveaway terminé pour l'instant.",
  "history.closed": "Participations fermées le {date}",
  "history.verify": "Vérifier le tirage",
  "history.verify.label": "Vérifier le tirage de {name}",

  "share.link": "Ton lien",
  "share.copyLink": "Copier le lien",
  "share.overlay": "Lien de l'overlay",
  "share.copyOverlay": "Copier le lien de l'overlay",
  "share.obs.1": "Dans OBS, trouve le panneau Sources et appuie sur le bouton +.",
  "share.obs.2": "Choisis Navigateur et appuie sur OK.",
  "share.obs.3": "Colle le lien de l'overlay dans le champ URL.",
  "share.obs.4": "Règle la largeur sur 800 et la hauteur sur 600, puis appuie sur OK.",
  "copy.copied": "Copié !",
  "copy.failed": "Impossible de copier. Le texte est sélectionné : appuie sur Ctrl+C.",

  "live.reconnecting": "Reconnexion au flux en direct…",
  "live.chatOff.title": "La surveillance du chat est désactivée",
  "live.chatEntryOff.text":
    "La participation par le chat est désactivée : Rafflink ne peut pas lire ton chat pour le moment, donc taper le mot-clé n'inscrit personne. Les viewers peuvent toujours participer sur la page du giveaway si elle accepte les participations.",
  "live.channelEntryOff.text":
    "La participation par sub et par points de chaîne est désactivée : Rafflink ne peut pas lire ces événements pour le moment, souvent parce qu'une autorisation a été retirée. Le moyen gratuit de participer n'est pas affecté. Reconnecte ton compte avant ton prochain giveaway.",
  "live.subEntryOff.text":
    "La participation par sub est désactivée : Rafflink ne peut pas lire les nouveaux subs pour le moment, souvent parce qu'une autorisation a été retirée, donc un sub n'inscrit personne. Les autres moyens de participer ne sont pas affectés. Reconnecte ton compte avant ton prochain giveaway.",
  "live.pointsEntryOff.text":
    "La participation par points de chaîne est désactivée : Rafflink ne peut pas lire les échanges de la récompense pour le moment, souvent parce qu'une autorisation a été retirée, donc un échange n'inscrit personne. Les autres moyens de participer ne sont pas affectés. Reconnecte ton compte avant ton prochain giveaway.",
  "live.entryWayOff.title": "La participation est partiellement désactivée",
  "live.chatOff.text":
    "Réclamation par le chat indisponible : Rafflink ne peut pas lire ton chat pour le moment, donc les gagnants ne peuvent pas réclamer en y écrivant. Quand un gagnant te dit qu'il est là, appuie sur Marquer comme réclamé à côté de son nom.",
  "live.closesAt": "Les participations se ferment toutes seules le {time}.",
  "live.close.label": "Fermer les participations",
  "live.close.question": "Fermer les participations maintenant ?",
  "live.close.detail": "Plus personne ne pourra participer ensuite. Tu ne peux pas annuler.",
  "live.close.confirm": "Oui, fermer les participations",
  "live.share.title": "Partager avec ton chat",
  "live.overlay.title": "L'afficher sur ton stream",
  "live.overlay.mode": "Quoi afficher",
  "live.overlay.mode.auto": "Automatique",
  "live.overlay.mode.auto.help":
    "Le lien de participation et le compteur pendant que les gens s'inscrivent, puis les gagnants.",
  "live.overlay.mode.compact": "Badge dans un coin",
  "live.overlay.mode.compact.help":
    "Le lien de participation, le compteur et les derniers noms, puis une petite ligne avec les gagnants.",
  "live.overlay.mode.winner": "Gagnants seulement",
  "live.overlay.mode.winner.help": "Vide jusqu'au tirage, puis uniquement les gagnants.",
  "live.overlay.qr": "QR code",
  "live.overlay.qr.help":
    "Les viewers sur une TV ou une console ne peuvent pas cliquer sur le lien.",
  "live.overlay.qr.on": "Afficher",
  "live.overlay.qr.off": "Masquer",
  "overlayStyle.dash.summary": "Style de l'overlay",
  "overlayStyle.dash.help":
    "L'apparence de ton overlay OBS. Un giveaway peut avoir son propre style sur sa page live.",
  "overlayStyle.giveaway.summary": "Style de cet overlay",
  "overlayStyle.giveaway.source": "Style",
  "overlayStyle.giveaway.streamer": "Mon style",
  "overlayStyle.giveaway.streamer.help": "Le style de ton tableau de bord.",
  "overlayStyle.giveaway.own": "Seulement ce giveaway",
  "overlayStyle.giveaway.own.help": "Le style de ton tableau de bord reste tel quel.",
  "overlayStyle.accent": "Accent",
  "overlayStyle.background": "Plaques",
  "overlayStyle.text": "Texte",
  "overlayStyle.font": "Police",
  "overlayStyle.size": "Taille",
  "overlayStyle.size.small": "Petite",
  "overlayStyle.size.medium": "Moyenne",
  "overlayStyle.size.large": "Grande",
  "overlayStyle.position": "Coin",
  "overlayStyle.position.top-left": "En haut à gauche",
  "overlayStyle.position.top-right": "En haut à droite",
  "overlayStyle.position.bottom-left": "En bas à gauche",
  "overlayStyle.position.bottom-right": "En bas à droite",
  "overlayStyle.corners": "Coins des plaques",
  "overlayStyle.corners.rounded": "Arrondis",
  "overlayStyle.corners.square": "Carrés",
  "overlayStyle.sound": "Son quand un gagnant s'affiche",
  "overlayStyle.sound.help":
    "Active Contrôler l'audio via OBS dans la source navigateur pour l'entendre sur le stream.",
  "overlayStyle.confetti": "Confettis quand un gagnant s'affiche",
  "overlayStyle.confetti.help": "Désactivés quand l'ordinateur demande moins d'animations.",
  "overlayStyle.on": "Activé",
  "overlayStyle.off": "Désactivé",
  "overlayStyle.preview": "Aperçu",
  "overlayStyle.preview.prize": "Une chaise gaming",
  "overlayStyle.lowContrast":
    "Le texte est difficile à lire sur ces plaques. Choisis une couleur de texte plus claire ou plus foncée.",
  "overlayStyle.save": "Enregistrer le style",
  "overlayStyle.reset": "Revenir au style par défaut",
  "overlayStyle.saved": "Enregistré. OBS affiche le nouveau style immédiatement.",
  "overlayStyle.rejected": "Le style n'a pas été enregistré. Recharge la page et réessaie.",
  "live.draw.title": "Les participations sont fermées",
  "live.draw.text": "{people}. Tire le gagnant quand tu es prêt.",
  "live.draw.count": "Gagnants prévus",
  "live.draw.batchCount": "Gagnants à la fois",
  "live.draw.batchInvalid": "Choisis entre 1 et {most}",
  "live.draw.nobody": "Personne n'a participé, il n'y a donc personne à tirer.",
  "live.draw.random": "Le gagnant est tiré au hasard parmi tous les participants.",
  "live.draw.label": "Tirer le gagnant",
  "drawResult.requested":
    "Les participations sont fermées. Le gagnant est tiré automatiquement dès que le nombre aléatoire est prêt.",
  "drawResult.not-open":
    "Le giveaway a changé pendant que tu appuyais sur Tirer le gagnant. Appuie à nouveau.",
  "drawResult.no-entrants-left": "Tous les participants ont été tirés.",
  "drawResult.pick-limit":
    "Ce giveaway ne peut pas accueillir autant de gagnants supplémentaires. Tires-en moins, ou aucun s'il est plein.",
  "drawResult.try-again":
    "Un autre tirage a eu lieu au même moment. Appuie à nouveau sur Tirer le gagnant.",
  "live.draw.next": "Tirer le gagnant suivant",
  "live.draw.question": "Fermer les participations et tirer un gagnant ?",
  "live.draw.due": "Tirage du gagnant…",
  "live.draw.nobodyLeft": "Tous les participants ont été tirés.",
  "live.draw.detail":
    "Les participations se ferment définitivement. Le gagnant est tiré dans quelques instants, même si tu fermes cette page.",
  "live.draw.confirm": "Oui, fermer les participations et tirer",
  "live.draw.waiting":
    "En attente du nombre aléatoire public (drand). Le gagnant sera tiré automatiquement dans {clock}.",
  "live.winners.title": "Gagnants",
  "live.winners.pageOrChat":
    "Chaque gagnant dispose d'un temps limité pour réclamer le lot. Il réclame sur la page du giveaway ou en écrivant dans ton chat.",
  "live.winnerFallback": "gagnant {n}",
  "live.mark.label": "Marquer comme réclamé",
  "live.mark.aria": "Marquer comme réclamé pour {name}",
  "live.reroll.over":
    "Le délai pour tirer un autre gagnant est écoulé. Contacte les gagnants qui n'ont pas réclamé, ou lance un nouveau giveaway.",
  "live.reroll.question": "Tirer un autre gagnant à la place de {name} ?",
  "live.reroll.detail": "{name} perd le lot. Cette action est irréversible.",
  "live.reroll.confirm": "Oui, tirer un autre gagnant",
  "live.problems.title": "Problèmes",
  "live.bar.label": "Commandes du giveaway",
  "live.settings.title": "Paramètres du giveaway",
  "live.stats.title": "Statistiques",
  "live.side.label": "Statistiques et paramètres",
  "live.bar.waiting": "En attente de la réclamation du lot par {name}.",
  "live.bar.claimed": "{name} a réclamé le lot.",
  "live.bar.unclaimed": "Personne n'a encore réclamé le lot.",
  "live.clean.hide": "Masquer les commandes",
  "live.clean.show": "Afficher les commandes",
  "live.support": "Soutenir",
  "live.chat.title": "Chat",
  "live.chat.hint": "Les messages du gagnant dans le chat s'affichent ici.",
  "live.chat.hint.settled": "Si le gagnant écrit dans le chat, tu le verras ici.",
  "live.chip": "LIVE",
  "live.gives": "{streamer} fait gagner {prize}",
  "live.winnerOf": "Gagnant {n} sur {total}",
  "live.pickedFrom": "Tiré parmi {tickets}",
  "live.progress": "Gagnants tirés",
  "live.winnerSub": "Sub {tier}",
  "live.claimHint.anyChat":
    "{name}, écris n'importe quoi dans le chat ou appuie sur Réclamer mon lot sur ta page du giveaway.",
  "live.claimHint.keyword":
    "{name}, tape {keyword} dans le chat ou appuie sur Réclamer mon lot sur ta page du giveaway.",
  "live.claimHint.page": "{name}, appuie sur Réclamer mon lot sur ta page du giveaway.",
  "live.entries.label": "Participations",
  "live.entries.open": "Ouvertes",
  "live.entries.closed": "Fermées",
  "live.reroll.bar": "Remplacer {name}",
  "live.reroll.label": "Retirer au sort",
  "live.overlay.link": "Lien de l'overlay",

  "wizard.step.basics": "Les bases",
  "wizard.step.rules": "Règles de participation",
  "wizard.step.review": "Vérification",
  "wizard.q.basics": "Commence par les bases",
  "wizard.q.rules": "Définis les règles de participation",
  "wizard.group.entry": "Qui et comment",
  "wizard.group.odds": "Chances",
  "wizard.group.winners": "Gagnants",
  "wizard.q.audience": "Qui peut participer",
  "wizard.q.review": "Vérifie ton giveaway",
  "wizard.fix": "Corrige ceci pour continuer.",
  "wizard.start": "Lancer le giveaway",
  "wizard.starting": "Lancement…",
  "wizard.title.label": "Nom du giveaway",
  "wizard.title.placeholder": "Giveaway chaise gaming du vendredi",
  "wizard.prize.label": "Que reçoit le gagnant ?",
  "wizard.prize.placeholder": "Une chaise gaming, ou une carte Steam de 25 euros",
  "wizard.audience.everyone": "Tout le monde",
  "wizard.audience.everyone.help": "N'importe quel viewer peut participer.",
  "wizard.audience.followers": "Followers uniquement",
  "wizard.audience.followers.help":
    "Seules les personnes qui suivent ta chaîne peuvent participer.",
  "wizard.audience.subscribers": "Abonnés uniquement",
  "wizard.audience.subscribers.help": "Seuls tes abonnés payants peuvent participer.",
  "wizard.audience.subscribers.warning":
    "Une participation réservée aux abonnés peut compter comme une loterie payante dans certains pays.",
  "wizard.audience.subscribers.info":
    "Un abonnement est un achat payant. Dans de nombreux pays, un giveaway qui exige un achat pour participer est une loterie réglementée. Pense à laisser aussi participer les followers ou tous les viewers.",
  "wizard.minAge.label": "Ancienneté minimale du compte en jours",
  "wizard.minAge.help": "Bloque les comptes tout juste créés.",
  "wizard.minAge.fewer": "Moins de jours",
  "wizard.minAge.more": "Plus de jours",
  "wizard.official.legend": "Règlement officiel (facultatif)",
  "wizard.official.help": "Seulement si ton giveaway en a besoin.",
  "wizard.winnerAge.label": "Âge minimum pour gagner, en années",
  "wizard.winnerAge.info":
    "Rafflink ne peut pas vérifier l'âge. C'est toi qui le vérifies avant de remettre le lot.",
  "wizard.winnerAge.fewer": "Moins d'années",
  "wizard.winnerAge.more": "Plus d'années",
  "wizard.excludedCountries.label": "Lieux où l'on ne peut pas gagner",
  "wizard.excludedCountries.help": "Rafflink ne peut pas vérifier où vit quelqu'un.",
  "wizard.excludedCountries.placeholder": "ex. Québec, Italie",
  "wizard.extraTerms.label": "Conditions supplémentaires",
  "wizard.extraTerms.help": "Affichées sous les règles exactement comme tu les écris.",
  "wizard.recent.legend": "Derniers gagnants",
  "wizard.recent.off": "Désactivé",
  "wizard.recent.off.help":
    "Les gagnants de tes giveaways précédents peuvent participer à nouveau.",
  "wizard.recent.giveaways": "Derniers giveaways",
  "wizard.recent.giveaways.help":
    "Les gagnants de tes derniers giveaways tirés ne peuvent pas participer.",
  "wizard.recent.days": "Derniers jours",
  "wizard.recent.days.help":
    "Les gagnants des giveaways que tu as créés ces derniers jours ne peuvent pas participer.",
  "wizard.recent.count.giveaways": "Combien de giveaways en arrière",
  "wizard.recent.count.days": "Combien de jours en arrière",
  "wizard.recent.fewer": "Moins",
  "wizard.recent.more": "Plus",
  "wizard.winnerForm.legend": "Formulaire du gagnant",
  "wizard.winnerForm.help": "Demandé après la réclamation. Toi seul vois les réponses.",
  "wizard.winnerForm.info":
    "Les réponses sont supprimées quand tu marques le lot comme livré, au plus tard 30 jours après la réclamation.",
  "wizard.tickets.legend": "Tickets bonus",
  "wizard.tickets.help": "Donne des tickets bonus à certains groupes.",
  "wizard.tickets.fewer": "Moins de tickets pour {group}",
  "wizard.tickets.more": "Plus de tickets pour {group}",
  "odds.same": "Tout le monde a la même chance de gagner.",
  "odds.viewersOut": "Les viewers ne reçoivent aucun ticket et ne peuvent pas gagner.",
  "odds.noBetter": "Aucun groupe n'a plus de chances qu'un viewer.",
  "odds.follower": "Un follower a {times} fois plus de chances qu'un viewer.",
  "odds.sub_t1": "Un sub Tier 1 a {times} fois plus de chances qu'un viewer.",
  "odds.sub_t2": "Un sub Tier 2 a {times} fois plus de chances qu'un viewer.",
  "odds.sub_t3": "Un sub Tier 3 a {times} fois plus de chances qu'un viewer.",
  "odds.member": "Un membre de la chaîne a {times} fois plus de chances qu'un viewer.",
  "odds.vip": "Un VIP a {times} fois plus de chances qu'un viewer.",
  "odds.moderator": "Un modérateur a {times} fois plus de chances qu'un viewer.",
  "wizard.ending.legend": "Quand les participations se terminent-elles ?",
  "wizard.ending.never": "Quand je les ferme",
  "wizard.ending.never.help":
    "Les participations restent ouvertes jusqu'à ce que tu appuies sur Fermer les participations.",
  "wizard.ending.atTime": "À une heure précise",
  "wizard.ending.atTime.help": "Les participations se ferment toutes seules à l'heure choisie.",
  "wizard.closesAt.label": "Fin des participations",
  "wizard.closesAt.help": "Le fuseau horaire de cet appareil est utilisé.",
  "wizard.claim.legend": "Délai pour réclamer",
  "wizard.claim.custom": "Personnalisé",
  "wizard.claim.minutes": "Minutes",
  "wizard.claim.fewer": "Moins de minutes",
  "wizard.claim.more": "Plus de minutes",
  "wizard.keyword.label": "Mot pour réclamer",
  "wizard.keyword.help":
    "Laisse vide et n'importe quel message du gagnant dans le chat suffit pour réclamer.",
  "review.name": "Nom",
  "review.prize": "Lot",
  "review.who": "Qui peut participer",
  "review.tickets": "Tickets",
  "review.age": "Ancienneté du compte",
  "review.end": "Fin des participations",
  "review.claim": "Délai de réclamation",
  "review.notSet": "Non défini",
  "review.everyoneOne": "Tout le monde reçoit 1 ticket.",
  "review.ageText": "Les comptes doivent avoir au moins {days}.",
  "review.winnerAge": "Âge minimum pour gagner",
  "review.excludedCountries": "Impossible de gagner en",
  "review.extraTerms": "Conditions supplémentaires",
  "review.recent": "Derniers gagnants",
  "review.endsManual": "Quand tu les fermes.",
  "review.claimText": "{time}. {chat}",
  "review.anyChat": "N'importe quel message du gagnant dans le chat compte aussi.",
  "review.keywordChat": "Le gagnant peut aussi taper « {keyword} » dans ton chat.",
  "wizard.entry.legend": "Comment les viewers participent",
  "wizard.entry.page": "Page du giveaway",
  "wizard.entry.page.help": "Les viewers se connectent sur la page du giveaway.",
  "wizard.entry.both": "Page et chat",
  "wizard.entry.both.help":
    "Les viewers peuvent aussi participer en tapant un mot-clé dans ton chat.",
  "wizard.entry.chat": "Chat uniquement",
  "wizard.entry.chat.help":
    "Les viewers participent uniquement en tapant un mot-clé dans ton chat. La page affiche le mot-clé et leur permet de vérifier s'ils sont inscrits.",
  "wizard.reconnect.followers.info":
    "Pour vérifier qui te suit, Rafflink doit pouvoir lire tes followers. Reconnecte Twitch ; tes réponses sont conservées.",
  "wizard.reconnect.subs.info":
    "Pour inscrire les nouveaux abonnés ou donner aux abonnés leurs tickets, Rafflink doit pouvoir lire tes abonnés. Reconnecte Twitch ; tes réponses sont conservées.",
  "wizard.reconnect.redemptions.info":
    "Pour inscrire les viewers qui échangent une récompense de points de chaîne, Rafflink doit pouvoir lire tes récompenses et les échanges. Reconnecte Twitch ; tes réponses sont conservées.",
  "wizard.reconnect.roles.info":
    "Pour donner aux VIP et aux modérateurs leurs tickets, Rafflink doit pouvoir lire tes VIP et tes modérateurs. Reconnecte Twitch ; tes réponses sont conservées.",
  "wizard.reconnect.modlinks.info":
    "Pour vérifier qui modère ta chaîne, Rafflink doit pouvoir lire tes modérateurs. Reconnecte Twitch, puis crée le lien.",
  "wizard.reconnect.points.info.kick":
    "Pour lister tes récompenses de points de chaîne, Rafflink doit pouvoir les lire. Reconnecte Kick ; tes réponses sont conservées.",
  "wizard.reconnect.button": "Reconnecter {platform}",
  "wizard.reconnect.text": "Il faut encore une autorisation {platform}.",
  "wizard.chatKeyword.label": "Mot-clé de participation",
  "wizard.chatKeyword.help": "Un message du chat qui commence par ce mot inscrit le viewer.",
  "wizard.chatKeyword.info":
    "Mêmes règles et mêmes tickets que sur la page. Rafflink n'écrit jamais dans ton chat.",
  "wizard.chatCost.kick":
    "Utilise une requête serveur par message du chat. Il en reste {remaining} aujourd'hui.",
  "wizard.chatCost.kick.info":
    "Kick envoie chaque message du chat à Rafflink tant que les participations sont ouvertes, avec ou sans le mot-clé. Ce serveur autorise {limit} requêtes par jour ; un chat de 100 messages par minute en utilise 6 000 par heure.",
  "wizard.chatCost.youtube":
    "La lecture du chat utilise des unités YouTube. Il en reste {remaining} aujourd'hui.",
  "wizard.chatCost.topic": "le coût de lecture du chat",
  "wizard.chatCost.youtube.info":
    "Rafflink lit le chat tant que les participations sont ouvertes, environ {perMinute} unités par minute, puis après le tirage, jusqu'à ce que les gagnants réclament, environ {winnerPerMinute} par minute. Ce serveur dispose de {limit} unités par jour.",
  "wizard.chatCost.youtubeByHand":
    "Tu fermes ce giveaway à la main, donc le serveur ne peut pas vérifier à l'avance que les unités du jour suffisent : elles couvrent environ {minutes} minutes de participations. Fixe une heure de fin pour que ce soit vérifié.",
  "wizard.autoEntry.legend": "Participations automatiques",
  "wizard.subEntry.label": "Inscrire les nouveaux abonnés",
  "wizard.subEntry.help":
    "Les nouveaux abonnés participent une fois. La participation sur la page ou dans le chat reste gratuite.",
  "wizard.subEntry.info":
    "Toute personne qui s'abonne, reçoit un sub offert ou partage un réabonnement dans le chat pendant que les participations sont ouvertes participe une fois, avec les tickets de son tier. Un renouvellement automatique silencieux n'inscrit pas : Twitch ne signale que les renouvellements que le viewer partage. La participation sur la page ou dans le chat reste gratuite, personne n'a donc besoin de payer pour participer.",
  "wizard.subEntry.info.kick":
    "Toute personne qui s'abonne, renouvelle son abonnement ou reçoit un sub offert pendant que les participations sont ouvertes participe une fois, avec les tickets d'un abonné. Kick n'a qu'un seul niveau d'abonnement et signale chaque renouvellement. La participation sur la page ou dans le chat reste gratuite, personne n'a donc besoin de payer pour participer.",
  "wizard.points.legend": "Récompense de points de chaîne",
  "wizard.points.help":
    "Les viewers qui échangent cette récompense pendant que les participations sont ouvertes participent une fois, comme pour toute autre participation. L'échange ne donne ni tickets supplémentaires ni meilleure chance de gagner.",
  "wizard.points.none":
    "Ta chaîne n'a pas encore de récompense de points de chaîne. Crées-en une dans les paramètres de ta chaîne, puis rouvre cette étape.",
  "wizard.points.off": "Aucune récompense",
  "wizard.points.selected":
    "Rafflink ne marque pas l'échange comme traité ; gère-le dans ta file de récompenses comme d'habitude.",
  "review.entry": "Participation",
  "review.entryPage": "Sur la page du giveaway.",
  "review.entryBoth": "Sur la page du giveaway ou en tapant « {keyword} » dans ton chat.",
  "review.entryChat": "Uniquement en tapant « {keyword} » dans ton chat.",
  "review.subEntry": "Les nouveaux abonnés sont inscrits automatiquement.",
  "review.pointsEntry": "Échanger « {reward} » inscrit un viewer.",
  "giveaway.chatEntry": "Ou tape {keyword} dans le chat de {name} pour participer.",
  "giveaway.lookup.legend": "Inscrit par le chat ?",
  "giveaway.lookup.label": "Ton nom d'utilisateur",
  "giveaway.lookup.button": "Suis-je inscrit ?",
  "giveaway.lookup.yes": "{login} participe au giveaway.",
  "giveaway.lookup.no":
    "{login} ne participe pas encore au giveaway. Une participation par le chat peut mettre une minute à apparaître.",
  "giveaway.lookup.failed": "La vérification n'a pas fonctionné. Réessaie.",

  "legal.privacy": "Confidentialité",
  "legal.terms": "Conditions",
  "legal.footerLabel": "Mentions légales",
  "legal.updated": "Dernière mise à jour : {date}",

  "legal.operator.id": "numéro d'entreprise {id}",
  "legal.unavailable": "Impossible de charger les informations sur l'opérateur de cette instance.",
  "legal.retry": "Réessayer",
  "legal.englishPrevails":
    "Ceci est une traduction. En cas de divergence avec la version anglaise, la version anglaise prévaut.",

  "privacy.title": "Politique de confidentialité",
  "privacy.intro":
    "Rafflink tire au sort les gagnants de giveaways sur Twitch, Kick et YouTube. Cette politique indique quelles données personnelles il traite, pourquoi, pendant combien de temps et quels sont tes droits. Elle est volontairement courte.",
  "privacy.controller.h": "Qui est responsable",
  "privacy.controller.p1":
    "Le responsable du traitement de tes données personnelles sur cette instance est {operator}. Contact : {contact}.",
  "privacy.controller.none":
    "Cette instance est gérée par son opérateur, qui n'a pas publié de coordonnées ici. Le logiciel n'envoie aucune donnée au projet Rafflink. Pour exercer un droit sur tes données ou poser une question, contacte la personne qui t'a partagé le lien.",
  "privacy.controller.p2":
    "Rafflink est open source et n'importe qui peut faire tourner sa propre copie. Ce texte décrit ce que fait le logiciel ; la personne qui gère une instance est le responsable du traitement des données qui s'y trouvent. Le projet Rafflink ne reçoit aucune donnée des instances gérées par d'autres.",
  "privacy.data.h": "Quelles données sont traitées",
  "privacy.data.p1":
    "Tout provient de Twitch, de Kick ou de YouTube, selon la plateforme avec laquelle tu te connectes. Rafflink demande uniquement un accès en lecture et ne publie jamais dans le chat.",
  "privacy.data.i1":
    "Streamers : l'identifiant utilisateur sur la plateforme, le nom de connexion, l'ancien nom de connexion après un changement de nom (conservé pour qu'un lien vers l'ancienne page d'historique public redirige), le nom affiché, l'URL de la photo de profil et la date de la première connexion, ainsi que les giveaways qu'ils créent (titre, texte du lot, règles, code du lien, dates) et leurs résultats.",
  "privacy.data.i2":
    "Streamers : le jeton d'actualisation (refresh token) de la plateforme, stocké chiffré. Il permet à Rafflink de lire les listes de VIP et de modérateurs de la chaîne et le chat pendant un giveaway, et de vérifier que la personne qui ouvre un lien de modérateur modère bien la chaîne.",
  "privacy.data.i3":
    "Participants : l'identifiant utilisateur sur la plateforme, le nom de connexion, le nom affiché, l'URL de la photo de profil, le groupe qui a donné les tickets (viewer, follower, tier d'abonnement, VIP ou modérateur), le nombre de tickets, l'heure de participation et une valeur aléatoire (sel) qui rend le tirage vérifiable. La vérification du follow et de l'abonnement utilise ton jeton Twitch une seule fois, et le jeton n'est pas conservé.",
  "privacy.data.i4":
    "Toute personne tirée au sort, y compris les tirages remplacés : l'identifiant utilisateur sur la plateforme, le nom de connexion, le nom affiché, le résultat du tirage et si et comment le lot a été réclamé. L'identifiant utilisateur reste associé au tirage même après le remplacement du nom par « supprimé ».",
  "privacy.data.i5":
    "Messages du chat : lus en mémoire pour reconnaître le mot-clé de participation et la réclamation d'un gagnant, et pour afficher les messages du gagnant sur la page live. Ils ne sont jamais stockés ni journalisés. Taper le mot-clé de participation enregistre ton identifiant utilisateur sur la plateforme, ton nom de connexion, ton nom affiché et les rôles qu'indiquent tes badges de chat jusqu'à la vérification de la participation ; tu deviens alors un participant comme sur la page, et le follow est vérifié avec le jeton du streamer.",
  "privacy.data.i6":
    "Données techniques : l'hébergeur traite ton adresse IP et les détails de tes requêtes pour fournir la page et la protéger contre les abus, par exemple avec des limites de débit.",
  "privacy.data.i7":
    "Salles des giveaways : les identifiants utilisateur Twitch des VIP et des modérateurs de la chaîne, stockés pour appliquer les règles de tickets. Ils sont supprimés avec les participations du giveaway.",
  "privacy.data.i8":
    "Modérateurs qui ouvrent un lien de modérateur : le lien ne stocke qu'un hash de son secret. Quand un lien est destiné aux modérateurs de la chaîne, le modérateur se connecte avec Twitch et Rafflink compare son identifiant utilisateur Twitch aux modérateurs de la chaîne. L'identifiant n'est conservé que dans le cookie du modérateur, rien d'autre le concernant n'est stocké, et aucun jeton Twitch n'est conservé.",
  "privacy.data.i9":
    "Comptes bloqués : un streamer peut bloquer des comptes de ses giveaways. Rafflink stocke alors l'identifiant utilisateur sur la plateforme et le nom de connexion de la personne bloquée, ainsi que la date du blocage, avec le compte du streamer. Chaque salle de giveaway du streamer garde une copie des identifiants bloqués pour pouvoir les refuser. Si la personne participait déjà à un giveaway encore ouvert, cette participation est supprimée.",
  "privacy.data.i10":
    "Derniers gagnants : quand un streamer exclut les derniers gagnants, les identifiants utilisateur sur la plateforme des gagnants de ses giveaways précédents sont copiés dans la salle du nouveau giveaway pour qu'elle puisse les refuser.",
  "privacy.data.i11":
    "Gagnants qui remplissent un formulaire du gagnant : les réponses demandées par le streamer, comme le nom, l'e-mail, l'adresse de livraison, un identifiant de compte de jeu ou un message au streamer. Elles sont stockées chiffrées, seul le streamer du giveaway peut les lire, pour livrer le lot, et elles ne sont jamais écrites dans les journaux. Le gagnant ne peut envoyer le formulaire qu'une fois.",
  "privacy.purposes.h": "Pourquoi et sur quelle base légale",
  "privacy.purposes.i1":
    "Pour faire fonctionner les giveaways que les streamers créent et permettre aux viewers d'y participer, y compris le tirage et la réclamation : exécution d'un contrat avec toi, le service que tu as demandé (article 6, paragraphe 1, point b) du RGPD).",
  "privacy.purposes.i2":
    "Pour garder le service sûr et équitable : une participation par compte, limites de débit, validation horaire des jetons des streamers. Notre intérêt légitime (article 6, paragraphe 1, point f)).",
  "privacy.purposes.i3":
    "Pour te garder connecté avec des cookies strictement nécessaires à cet effet. Rafflink n'utilise aucune publicité, aucun outil d'analyse et aucun pistage, et il ne vend ni ne partage de données à des fins de marketing. Il ne conserve que des totaux agrégés qui ne contiennent aucune donnée personnelle, comme les visites par label de provenance par jour et les participations et réclamations par minute.",
  "privacy.retention.h": "Combien de temps les données sont conservées",
  "privacy.retention.i1":
    "Les participations (identifiants utilisateur sur la plateforme, noms, URL des photos, groupes, tickets, heures de participation, sels) sont supprimées au plus tard 30 jours après la fermeture du giveaway ; l'opérateur peut fixer une durée plus courte. Cela supprime aussi les participations des personnes tirées au sort ; leur identifiant utilisateur et leurs noms restent associés à leur tirage, y compris les tirages remplacés (voir ci-dessous).",
  "privacy.retention.i2":
    "Quand un streamer retire l'accès de Rafflink sur Twitch, Kick ou YouTube, seul le jeton stocké est supprimé. Le compte et ses giveaways restent jusqu'à ce que le streamer les supprime dans le tableau de bord, un giveaway ou toutes les données à la fois, ou demande à l'opérateur de le faire (voir le contact ci-dessus).",
  "privacy.retention.i3":
    "Les codes de connexion en attente dans la file sont supprimés au bout de quelques minutes.",
  "privacy.retention.i4":
    "Les journaux de l'hébergeur sont conservés par l'opérateur ou son hébergeur selon leurs propres conditions.",
  "privacy.retention.i5":
    "Le giveaway (titre, lot, règles, dates, nombres de participants et de tickets), toutes les personnes tirées au sort, y compris les tirages remplacés, avec leur identifiant utilisateur sur la plateforme, leur nom de connexion, leur nom affiché et l'état de leur réclamation, la racine de Merkle de la liste des participations et la liste de ses feuilles (hashs et nombres de tickets, sans noms) restent jusqu'à ce que le streamer supprime le giveaway, pour que le lot puisse être livré et que tout le monde puisse vérifier le tirage plus tard. L'opérateur peut fixer un nombre de jours après la clôture du tirage au bout duquel les giveaways sont supprimés.",
  "privacy.retention.i6":
    "Un blocage (identifiant utilisateur sur la plateforme et nom de connexion) est conservé pour tenir cette personne à l'écart des giveaways du streamer, jusqu'à ce que le streamer le retire dans le tableau de bord ou supprime son compte. Les copies des identifiants bloqués et des derniers gagnants dans une salle de giveaway sont supprimées avec les participations de ce giveaway, au plus tard 30 jours après sa fermeture.",
  "privacy.retention.i7":
    "Les réponses au formulaire du gagnant sont supprimées quand le streamer marque le lot comme livré, au plus tard 30 jours après la réclamation ; l'opérateur peut fixer une durée plus courte. Seules les dates d'envoi du formulaire et de livraison du lot restent associées au tirage. La suppression du giveaway ou du compte du streamer supprime immédiatement les réponses.",
  "privacy.recipients.h": "Qui d'autre voit les données",
  "privacy.recipients.p1":
    "Rafflink ne vend pas de données. Les données ne sont transmises qu'aux parties suivantes.",
  "privacy.recipients.i1":
    "L'hébergeur de cette instance stocke et fournit le service en tant que sous-traitant de l'opérateur et peut traiter des données en dehors de l'Espace économique européen selon ses propres conditions et garanties.",
  "privacy.recipients.i2":
    "Twitch est le fournisseur d'identité pour les connexions via Twitch. Il reçoit ta connexion et, pendant un giveaway, des appels d'API qui vérifient les follows, les abonnements et les rôles, ainsi que l'abonnement au chat utilisé pour reconnaître une réclamation. Le navigateur du streamer charge aussi les photos de profil et les badges d'abonné depuis les serveurs d'images de Twitch. Twitch est un responsable du traitement indépendant, soumis à sa propre politique de confidentialité. Kick est le fournisseur d'identité pour les connexions via Kick. Il reçoit ta connexion et, pendant un giveaway, l'abonnement qui envoie les messages du chat du streamer à Rafflink. Kick est un responsable du traitement indépendant, soumis à sa propre politique de confidentialité. Google est le fournisseur d'identité des connexions avec YouTube. Il reçoit la connexion du streamer et, pendant un giveaway, les appels d'API qui trouvent le live et lisent son chat. Google est un responsable de traitement indépendant, soumis à ses propres règles de confidentialité.",
  "privacy.recipients.i3":
    "Le streamer qui organise un giveaway voit ses participants et ses gagnants. Les noms des participants et des gagnants sont affichés sur la page live et l'overlay du giveaway, et leurs photos de profil sur la page live.",
  "privacy.recipients.i4":
    "La balise publique d'aléa drand est consultée pour le tirage. Aucune donnée personnelle ne lui est envoyée.",
  "privacy.recipients.i5":
    "Quand un streamer active son historique public, tout le monde peut y voir le nom du streamer et ses giveaways terminés : titre, lot, date de fermeture et nombres de participants et de gagnants. La page ne nomme aucun participant ni aucun gagnant, et le streamer peut masquer certains giveaways ou désactiver la page. Les moteurs de recherche n'indexent la page que si le streamer l'autorise.",
  "privacy.recipients.i6":
    "Les réponses au formulaire du gagnant vont au streamer qui organise le giveaway et à personne d'autre : les modérateurs, l'overlay et les pages publiques ne les affichent jamais.",
  "privacy.recipients.i7":
    "Si l'exploitant active le signalement des erreurs, Sentry (Functional Software, Inc.) reçoit, en tant que sous-traitant de l'exploitant, les rapports d'erreurs du navigateur et du serveur et les conserve dans sa région UE en Allemagne. Un rapport contient l'erreur, l'endroit où elle s'est produite, le navigateur et le système d'exploitation ; comme tout serveur, Sentry voit l'adresse IP de la connexion. Les cookies, le contenu des requêtes, les codes de connexion, les jetons Twitch, Kick et Google et les réponses des gagnants au formulaire sont retirés avant l'envoi d'un rapport.",
  "privacy.youtube.h": "YouTube",
  "privacy.youtube.p1":
    "Rafflink utilise les services d'API YouTube. En te connectant avec YouTube, tu acceptes les Conditions d'utilisation de YouTube ({youtubeTerms}). Les Règles de confidentialité de Google ({googlePrivacy}) s'appliquent à ce que Google fait de tes données.",
  "privacy.youtube.i1":
    "Un streamer YouTube se connecte avec Google et donne à Rafflink un accès en lecture seule à son compte YouTube. Rafflink conserve l'identifiant de la chaîne, son handle, son nom et un jeton d'actualisation scellé, et lit le live en cours et son chat.",
  "privacy.youtube.i2":
    "Les spectateurs ne se connectent jamais avec Google. Ils participent en écrivant le mot-clé dans le chat, et Rafflink lit l'identifiant de leur chaîne, le nom affiché dans le chat, le message et s'ils sont membres de la chaîne ou modérateurs.",
  "privacy.youtube.i3":
    "Les données YouTube des spectateurs que Rafflink conserve sont supprimées sous 30 jours : les participations au plus tard 30 jours après la fin du giveaway, et avec elles les noms des gagnants, si bien que seul l'identifiant de leur chaîne reste avec le tirage.",
  "privacy.youtube.i4":
    "Tu peux retirer à tout moment l'accès de Rafflink à ton compte YouTube dans les autorisations de ton compte Google ({googlePermissions}). Le jeton conservé est alors supprimé lors de la vérification horaire suivante.",
  "privacy.cookies.h": "Cookies et stockage local",
  "privacy.cookies.p1":
    "Rafflink ne dépose que des cookies strictement nécessaires, aucune bannière de consentement n'est donc affichée. Ils sont tous HTTP-only et ne servent à rien d'autre.",
  "privacy.cookies.i1": "rl_streamer : garde un streamer connecté, 7 jours par défaut.",
  "privacy.cookies.i2":
    "rl_viewer : permet à un viewer qui revient de voir son résultat sans se reconnecter, 30 jours par défaut.",
  "privacy.cookies.i3":
    "rl_oauth_streamer_* et rl_oauth_viewer_* : protègent une connexion contre la falsification, 10 minutes par défaut.",
  "privacy.cookies.i4":
    "rl_pending_* : permet au navigateur qui a mis une participation en file d'en récupérer le résultat, 10 minutes par défaut.",
  "privacy.cookies.i5":
    "Le stockage local de ton navigateur conserve ton choix de langue et de thème ainsi que le mode épuré de la page live. Le stockage de session conserve une copie de la page du giveaway que tu as chargée, y compris ton propre état, pendant environ 30 secondes. Aucun des deux ne quitte ton appareil.",
  "privacy.cookies.i7":
    "rl_entry_scopes : mémorise quelles autorisations supplémentaires (followers, abonnés, récompenses, VIP et modérateurs) la dernière connexion de streamer dans ce navigateur a accordées, pour que la connexion suivante les redemande ; 400 jours, conservé à la déconnexion.",
  "privacy.cookies.i6":
    "rl_mod_* : permet à la personne qui a ouvert un lien de modérateur d'utiliser la page de modération de ce giveaway, 7 jours par défaut ou jusqu'à ce que le streamer révoque le lien. rl_mod_pending : mémorise quel lien attend la connexion Twitch du modérateur, 10 minutes par défaut.",
  "privacy.rights.h": "Tes droits",
  "privacy.rights.p1":
    "Tu disposes des droits listés ci-dessous. Écris à {contact}. Nous répondons dans un délai d'un mois.",
  "privacy.rights.none":
    "L'opérateur de cette instance n'a pas publié de coordonnées ici, et la personne qui t'a partagé le lien n'est peut-être pas l'opérateur. Sans contact, il n'existe aucun moyen garanti d'exercer ces droits via cette page.",
  "privacy.rights.p2":
    "Tu peux aussi retirer l'accès de Rafflink à tout moment dans tes paramètres Twitch, sous Connexions, dans les paramètres de ton compte Kick ou dans les autorisations de ton compte Google.",
  "privacy.rights.i1":
    "Accès, rectification, limitation du traitement et portabilité de tes données.",
  "privacy.rights.i2":
    "Effacement, par exemple du nom d'un gagnant qui reste après le giveaway : l'opérateur le remplace par « supprimé », et le tirage reste vérifiable.",
  "privacy.rights.i3": "Opposition au traitement fondé sur notre intérêt légitime.",
  "privacy.rights.i4":
    "Une réclamation auprès de l'autorité de protection des données du pays où tu vis ou travailles, ou de celui où tu penses que tes droits ont été violés.",
  "privacy.changes.h": "Modifications",
  "privacy.changes.p1": "Quand cette politique change, la date en haut de page change avec elle.",

  "terms.title": "Conditions d'utilisation",
  "terms.intro":
    "En te connectant ou en participant à un giveaway sur Rafflink, tu acceptes ces conditions. Si tu ne les acceptes pas, n'utilise pas le service.",
  "terms.service.h": "Le service",
  "terms.service.p1":
    "Rafflink permet à un streamer Twitch, Kick ou YouTube de créer un giveaway, de recueillir des participations et de tirer des gagnants en direct. Cette instance est gérée par {operator}.",
  "terms.service.none":
    "Rafflink permet à un streamer Twitch, Kick ou YouTube de créer un giveaway, de recueillir des participations et de tirer des gagnants en direct. Cette instance est gérée par son opérateur, qui n'a pas publié de coordonnées ici. Contacte la personne qui t'a partagé le lien.",
  "terms.service.p2":
    "Le service est fourni en l'état et selon sa disponibilité, sans aucune garantie. Il peut être modifié, limité ou arrêté à tout moment, et il n'a aucune garantie de disponibilité.",
  "terms.source.h": "Open source",
  "terms.source.p1":
    "Le code source est sous licence GNU AGPL-3.0 et disponible sur {repository}. La licence s'applique au code. Ces conditions s'appliquent au service sur cette instance.",
  "terms.streamers.h": "Les streamers et l'organisateur",
  "terms.streamers.p1":
    "Tu es l'organisateur de chaque giveaway que tu crées. Rafflink fournit uniquement l'outil et le tirage. Rafflink n'est pas l'organisateur.",
  "terms.streamers.i1":
    "Tu es seul responsable de la conformité de chaque giveaway à la loi là où toi et tes viewers vous trouvez : le lot, les règles, l'éligibilité, les limites d'âge et de pays, les impôts, les règles sur les jeux d'argent et les loteries, et la livraison du lot.",
  "terms.streamers.i2":
    "La participation payante n'est pas autorisée. Un giveaway ne doit pas exiger de paiement pour participer, les tombolas et loteries payantes ne sont donc pas autorisées sur Rafflink.",
  "terms.streamers.i3":
    "Les tickets supplémentaires pour les abonnés ou les followers sont ton choix. Un abonnement est un achat payant, donc un giveaway réservé aux abonnés peut être considéré comme une participation payante là où toi ou tes viewers vivez. Vérifie-le avant de faire ce choix.",
  "terms.streamers.i4":
    "Tu es responsable de l'usage que tu fais des données des participants que tu vois, conformément à la loi sur la protection des données qui s'applique à toi.",
  "terms.viewers.h": "Les viewers",
  "terms.viewers.i1":
    "La participation est toujours gratuite du côté de Rafflink et nécessite un compte Twitch, Kick ou YouTube. Rafflink ne demande jamais aux viewers de payer.",
  "terms.viewers.i2":
    "Le lot vient du streamer, pas de Rafflink. Rafflink n'est pas partie au giveaway et ne promet ni lot ni livraison.",
  "terms.viewers.i3":
    "Un gain doit être réclamé dans le délai fixé par le streamer. Passé ce délai, le streamer peut procéder à un nouveau tirage.",
  "terms.platforms.h": "Twitch, Kick et YouTube",
  "terms.platforms.p1":
    "Les Conditions d'utilisation, les Règles de la communauté et le Contrat de services pour les développeurs de Twitch s'appliquent à ton utilisation de Twitch via Rafflink. Rafflink n'est ni affilié à Twitch ni approuvé par Twitch. Les conditions et règles de Kick s'appliquent à ton utilisation de Kick via Rafflink, et Rafflink n'est pas non plus affilié à Kick ni approuvé par Kick.",
  "terms.platforms.p2":
    "Rafflink utilise les services d'API YouTube, et les Conditions d'utilisation de YouTube ({youtubeTerms}) s'appliquent à ton utilisation de YouTube via Rafflink. Rafflink n'est ni affilié à YouTube ou à Google, ni approuvé par eux.",
  "terms.use.h": "Utilisation acceptable",
  "terms.use.p1": "Tu t'engages à ne pas :",
  "terms.use.i1":
    "utiliser de bots, de scripts ou toute autre automatisation pour participer ou réclamer,",
  "terms.use.i2": "participer avec plus d'un compte ou utiliser le compte de quelqu'un d'autre,",
  "terms.use.i3":
    "contourner les règles de participation, les limites de débit ou d'autres protections, ni perturber le service,",
  "terms.use.i4":
    "organiser des giveaways illégaux ni mettre un contenu illégal ou abusif dans un titre ou un texte de lot.",
  "terms.liability.h": "Responsabilité",
  "terms.liability.p1":
    "Dans la mesure permise par la loi, nous ne sommes pas responsables des pertes indirectes ou consécutives, d'un giveaway, d'un lot ou d'un litige entre un streamer et un viewer, ni d'une panne de Rafflink, de Twitch, de Kick ou de YouTube. Notre responsabilité totale est limitée au montant que tu nous as payé pour le service, soit rien pour un compte gratuit.",
  "terms.liability.p2":
    "Rien ici ne limite une responsabilité qui ne peut pas être limitée par la loi, comme la responsabilité pour faute intentionnelle ou pour dommage corporel, ni tes droits de consommateur.",
  "terms.changes.h": "Modifications",
  "terms.changes.p1":
    "Nous pouvons modifier ces conditions. La date en haut de page indique la version actuelle, et utiliser le service après une modification signifie que tu l'acceptes. Nous pouvons supprimer un giveaway ou bloquer un compte qui enfreint ces conditions.",
  "terms.contact.h": "Contact",
  "terms.contact.p1": "Questions sur ces conditions : {contact}.",
  "terms.contact.none":
    "L'opérateur de cette instance n'a pas publié de coordonnées ici. La personne qui t'a partagé le lien n'est peut-être pas l'opérateur.",
  "drawResult.round-pending":
    "Le nombre aléatoire n'est pas encore publié. Le gagnant sera tiré automatiquement dès qu'il le sera.",
  "drawResult.round-due":
    "Le nombre aléatoire arrive. Le gagnant sera tiré automatiquement dans un instant.",
  "drawResult.beacon-unavailable":
    "Impossible de joindre la source d'aléa (drand). Rien n'a été tiré. Réessaie.",
  "giveaway.verify.link": "Vérifier ce tirage",
  "viewer.runYourOwn": "Organise ton propre giveaway avec Rafflink",
  "verify.title": "Vérifier ce tirage",
  "verify.intro":
    "Vérifie dans ton navigateur que les gagnants découlent de la liste des participations et d'un nombre aléatoire public que personne ici ne contrôle.",
  "verifyLookup.title": "Vérifier un tirage",
  "verifyLookup.label": "Code ou lien du giveaway",
  "verifyLookup.help":
    "Un code comporte 5 lettres et chiffres, comme YNX9N. Tu peux aussi coller le lien qu'utilisent les viewers.",
  "verifyLookup.invalid": "Ce n'est pas un code ni un lien de giveaway.",
  "verifyLookup.submit": "Ouvrir la vérification",
  "verify.back": "Retour au giveaway",
  "verify.open":
    "Les participations sont encore ouvertes. La liste des participations est figée à leur fermeture.",
  "verify.closed.pending":
    "Les participations sont fermées et la liste est en train d'être figée. Recharge dans un instant.",
  "verify.unverifiable":
    "Ce giveaway a été tiré avant que les tirages puissent être vérifiés, il n'y a donc rien à vérifier.",
  "verify.facts.entrants": "Participants",
  "verify.facts.tickets": "Tickets",
  "verify.facts.root": "Racine de Merkle",
  "verify.facts.chain": "Chaîne drand",
  "verify.facts.round": "Round drand",
  "verify.facts.leaves": "Liste des participations",
  "verify.facts.leavesLink": "Ouvrir la liste des participations",
  "verify.run": "Vérifier",
  "verify.running": "Vérification…",
  "verify.verdict.verified": "Tirage vérifié",
  "verify.verdict.failed": "Le tirage ne correspond pas",
  "verify.verdict.incomplete": "Tout n'a pas pu être vérifié",
  "verify.checks.summary": "Ce qui a été vérifié",
  "verify.check.counts.match":
    "La liste contient autant de participations et de tickets qu'annoncé.",
  "verify.check.counts.mismatch":
    "La liste ne contient pas le nombre annoncé de participations et de tickets.",
  "verify.check.root.match": "La racine de Merkle de la liste est la racine publiée.",
  "verify.check.root.mismatch": "La racine de Merkle de la liste n'est pas la racine publiée.",
  "verify.check.signature.valid": "La signature du round drand {round} est valide.",
  "verify.check.signature.invalid":
    "La signature du round drand {round} n'est pas valide, donc rien de ce qui suit n'est fiable.",
  "verify.check.signature.unavailable":
    "La signature du round drand {round} n'a pas pu être vérifiée.",
  "verify.check.signature.none":
    "Aucun round n'est encore nécessaire, il n'y a donc aucune signature à vérifier.",
  "verify.check.winners.match":
    "Les gagnants découlent de la liste et du nombre aléatoire du round drand {round}.",
  "verify.check.winners.mismatch":
    "Les gagnants ne découlent pas de la liste et du nombre aléatoire du round drand {round}.",
  "verify.check.winners.unavailable":
    "Impossible de lire le round drand {round}. Réessaie plus tard.",
  "verify.check.winners.none": "Aucun gagnant n'est encore tiré, il n'y a donc rien à comparer.",
  "verify.winners.title": "Gagnants",
  "verify.winners.showAll": "Afficher les {count} tirages",
  "verify.winner.entry": "Le tirage {n} est la participation {leaf} de la liste.",
  "verify.winner.rerolled": "(remplacé)",
  "live.draw.fixed":
    "Gagnants tirés : {drawn} sur {planned} prévus. Tires-en autant que nécessaire.",
  "live.winners.save": "Enregistrer",
  "winnersResult.set": "Nombre de gagnants enregistré.",
  "winnersResult.rejected":
    "Impossible d'enregistrer. Saisis un nombre entier de gagnants, au moins 1.",
  "wizard.winners.label": "Nombre de gagnants",
  "wizard.winners.help": "Tu pourras le modifier plus tard.",
  "review.winners": "Gagnants",
  "verify.check.timing.match": "Le round drand a été publié après que la liste a été figée.",
  "verify.check.timing.mismatch":
    "Le round drand a été publié avant que la liste soit figée, donc le tirage n'est pas fiable.",
  "verify.facts.winners": "Gagnants prévus",
  "verify.facts.committed": "Liste figée le",
  "verify.rerolls.note": "Les remplacements et les tirages supplémentaires sont listés ici.",
  "verify.rerolls.count": "Tirages remplacés : {count}.",
  "verify.winner.before": "{count} tirages remplacés l'ont précédé.",
  "verify.mine.title": "Ta participation",
  "verify.mine.signedOut":
    "Connecte-toi sur la page du giveaway avec le compte utilisé pour participer afin de vérifier ta propre participation.",
  "verify.mine.chatOnly":
    "Sur un giveaway YouTube, on participe dans le chat sans se connecter : cette page ne peut donc pas afficher ta propre participation ni son sel privé. Les vérifications ci-dessus prouvent quand même que le tirage était équitable.",
  "verify.mine.hint":
    "Ta participation est hachée à partir de ces valeurs et de ton sel privé. Ne partage pas le sel.",
  "verify.mine.platform": "Plateforme",
  "verify.mine.user": "Identifiant utilisateur",
  "verify.mine.salt": "Sel (privé)",
  "verify.mine.noSalt":
    "Ta participation n'a pas encore de sel. Elle en reçoit un à la fermeture des participations. Recharge plus tard.",
  "verify.mine.found":
    "Ta participation est la participation {leaf} de la liste, avec {tickets} tickets.",
  "verify.mine.won": "Tu es le tirage {n}.",
  "verify.mine.missing": "Ta participation n'est pas dans la liste.",
  "nav.draw": "Tirer au sort dans une liste",
  "draw.title": "Tirer au sort dans une liste",
  "draw.intro":
    "Colle des noms, fige la liste, et un round drand public choisit les gagnants. Toute personne qui a le lien peut vérifier le tirage dans son propre navigateur. Sans connexion.",
  "draw.form.title": "Titre (facultatif)",
  "draw.form.titleTooLong": "Limite le titre à {max} caractères.",
  "draw.form.names": "Noms",
  "draw.form.namesHelp": "Un nom par ligne, jusqu'à {max}. Un nom répété ne compte qu'une fois.",
  "draw.form.count": "Noms : {count}. Doublons écartés : {repeats}.",
  "draw.form.empty": "Ajoute au moins un nom.",
  "draw.form.tooMany": "La liste est trop longue. La limite est de {max} noms.",
  "draw.form.winners": "Gagnants",
  "draw.form.winnersInvalid": "Choisis entre 1 et {max} gagnants.",
  "draw.commit": "Figer la liste",
  "draw.badLink": "Ce lien de tirage est cassé ou incomplet.",
  "draw.file.label": "Fichier de liste",
  "draw.file.help":
    "La liste était trop longue pour le lien. Ouvre le fichier de liste qui l'accompagne.",
  "draw.file.invalid": "Ce n'est pas un fichier de liste.",
  "draw.mismatch":
    "Les noms ne correspondent pas au hash de la liste. Le lien ou le fichier a été modifié, donc rien n'est tiré.",
  "draw.facts.names": "Noms",
  "draw.facts.winners": "Gagnants",
  "draw.facts.hash": "Hash de la liste",
  "draw.facts.roundAt": "Round publié le",
  "draw.facts.committed": "Liste figée le (horloge du navigateur qui l'a figée)",
  "draw.early":
    "Cette liste indique qu'elle a été figée après la publication du round drand {round}, donc le tirage n'est pas fiable.",
  "draw.seenBefore":
    "Tu as ouvert cette liste avant la publication du round drand {round}, elle a donc été figée avant que quiconque puisse connaître les gagnants.",
  "draw.waiting": "Les gagnants seront tirés à la publication du round drand {round}.",
  "draw.drawn": "Les gagnants découlent de la liste et du nombre aléatoire du round drand {round}.",
  "draw.invalid":
    "La signature du round drand {round} n'est pas valide, donc aucun gagnant n'est affiché.",
  "draw.unavailable": "Impossible de lire le round drand {round}. Réessaie plus tard.",
  "draw.retry": "Réessayer",
  "draw.share.label": "Lien de partage",
  "draw.share.copy": "Copier le lien de partage",
  "draw.share.withNames":
    "Le lien contient les noms. Toute personne qui l'ouvre les voit et obtient les mêmes gagnants.",
  "draw.share.noNames":
    "La liste est trop longue pour un lien. Partage le lien avec le fichier de liste.",
  "draw.download": "Télécharger le fichier de liste",
  "draw.new": "Nouveau tirage",
  "draw.proof.title": "Ce que cela prouve",
  "draw.proof.covers":
    "Les gagnants découlent exactement de ces noms et du nombre aléatoire du round drand. Tout le monde peut les recalculer, et personne ne connaît ce nombre avant la publication du round.",
  "draw.proof.private":
    "Les noms restent dans ton navigateur. Ils n'en sortent que dans le lien ou le fichier que tu partages.",
  "draw.proof.time":
    "L'heure à laquelle la liste a été figée vient du navigateur qui l'a figée, pas d'un serveur. Quelqu'un pourrait figer une liste après le round et prétendre une heure antérieure. Ne fais confiance au tirage que si tu as vu le hash de la liste ou le lien avant la publication du round.",
  "draw.proof.list":
    "Le tirage ne montre pas qui a sa place dans la liste. Vérifie les noms toi-même.",
  "live.mod.link": "Liens de modérateur",
  "live.mod.text":
    "Toute personne qui ouvre un lien peut fermer les participations, tirer, remplacer et marquer les réclamations pour ce giveaway. Elle ne peut pas modifier les règles, supprimer le giveaway ni voir ton compte.",
  "live.mod.who": "Qui peut l'utiliser",
  "live.mod.who.mods": "Les modérateurs de ma chaîne",
  "live.mod.who.mods.help":
    "Ils se connectent avec Twitch et Rafflink vérifie qu'ils modèrent ta chaîne.",
  "live.mod.reconnect":
    "Les liens réservés aux modérateurs demandent encore une autorisation Twitch.",
  "live.rolesPaused": "Tickets des VIP et des modérateurs en pause. Reconnecte Twitch.",
  "live.mod.who.anyone": "Toute personne qui a le lien",
  "live.mod.create": "Créer un lien",
  "live.mod.new": "Nouveau lien. Copie-le maintenant, il n'est affiché qu'une fois.",
  "live.mod.copy": "Copier le lien de modérateur",
  "live.mod.none": "Aucun lien de modérateur n'est actif.",
  "live.mod.item": "Lien {id}, créé à {time}",
  "live.mod.itemMod": "modérateurs uniquement",
  "live.mod.revoke": "Révoquer",
  "live.mod.revokeLabel": "Révoquer le lien {id}",
  "live.mod.loadFailed": "Impossible de charger les liens. Réessaie.",
  "modResult.revoked": "Lien révoqué. Il ne fonctionne plus.",
  "modResult.rejected": "Le lien n'a pas été modifié. Réessaie.",
  "live.actors.title": "Qui a fait quoi",
  "live.actors.closed": "Participations fermées par {who}",
  "live.actors.drawn": "Gagnant {n} tiré par {who}",
  "live.actors.rerolled": "Gagnant {n} remplacé par {who}",
  "live.actors.marked": "Gagnant {n} marqué comme réclamé par {who}",
  "live.actors.streamer": "le streamer",
  "live.actors.moderator": "le lien de modérateur {id}",
  "mod.invalid.title": "Ce lien de modérateur ne fonctionne pas",
  "mod.invalid.text":
    "Le streamer l'a révoqué, ou il a été mal copié. Demande un nouveau lien au streamer.",
  "mod.notMod.title": "Réservé aux modérateurs",
  "mod.notMod.text":
    "Ce lien est destiné aux modérateurs de la chaîne du streamer, et le compte Twitch avec lequel tu t'es connecté n'en fait pas partie.",
  "mod.signInAgain":
    "La connexion Twitch ne s'est pas terminée. Rouvre le lien envoyé par le streamer.",
  "mod.rateLimited": "Trop de tentatives depuis ton réseau. Attends une minute et rouvre le lien.",
  "signIn.why.moderator":
    "Ce lien de modérateur est destiné aux modérateurs de la chaîne. Connecte-toi avec Twitch pour que Rafflink puisse vérifier que tu en fais partie.",
}
