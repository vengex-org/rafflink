import type { ResolvedConfig } from "../config.ts"
import { TwitchError, type TwitchClient } from "../twitch/twitch-client.ts"

export type AdminConfig = Pick<ResolvedConfig, "admins">

/**
 * Who may open the admin page. Logins in the config are looked up at Twitch on the first check that needs
 * them and kept for the life of the process or isolate; a failed lookup denies and is tried again by the
 * next check.
 */
export class AdminDirectory {
  private lookup: Promise<ReadonlySet<string>> | null = null

  constructor(
    private readonly config: AdminConfig,
    private readonly twitch: Pick<TwitchClient, "appAccessToken" | "userIdsByLogin">,
  ) {}

  async isAdmin(twitchUserId: string): Promise<boolean> {
    if (this.config.admins.some((entry) => entry.kind === "id" && entry.id === twitchUserId)) {
      return true
    }
    if (this.logins().length === 0) return false
    try {
      return (await this.loginIds()).has(twitchUserId)
    } catch (error) {
      if (!(error instanceof TwitchError)) throw error
      console.warn("admin login lookup failed", {
        errorClass: error.constructor.name,
        endpoint: error.endpoint,
        status: error.status,
      })
      return false
    }
  }

  private logins(): string[] {
    return this.config.admins.flatMap((entry) => (entry.kind === "login" ? [entry.login] : []))
  }

  private loginIds(): Promise<ReadonlySet<string>> {
    this.lookup ??= this.resolveLogins().catch((error: unknown) => {
      this.lookup = null
      throw error
    })
    return this.lookup
  }

  private async resolveLogins(): Promise<ReadonlySet<string>> {
    const logins = this.logins()
    const found = await this.twitch.userIdsByLogin(await this.twitch.appAccessToken(), logins)
    const resolved = new Map<string, string>()
    for (const login of logins) {
      const id = found.get(login)
      if (id !== undefined) resolved.set(login, id)
    }
    console.info("admin logins resolved; pin these ids in ADMIN_TWITCH_IDS", {
      resolved: Object.fromEntries(resolved),
    })
    const unresolved = logins.filter((login) => !resolved.has(login))
    if (unresolved.length > 0) console.warn("admin logins without a Twitch account", { unresolved })
    return new Set(resolved.values())
  }
}
