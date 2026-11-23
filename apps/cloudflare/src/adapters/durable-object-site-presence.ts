import type { SitePresence } from "@rafflink/core/presence/site-presence"
import type { SitePresenceObject } from "../durable-objects/site-presence-do.ts"

const presenceObjectName = "site"

/** The one presence object of the deployment, which holds every page's socket. A stub belongs to the request that made it. */
export function sitePresenceStub(namespace: DurableObjectNamespace<SitePresenceObject>) {
  return namespace.get(namespace.idFromName(presenceObjectName))
}

export function durableObjectSitePresence(
  namespace: DurableObjectNamespace<SitePresenceObject>,
): SitePresence {
  return { counts: () => sitePresenceStub(namespace).counts() }
}
