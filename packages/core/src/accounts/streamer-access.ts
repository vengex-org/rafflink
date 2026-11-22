import type { AdminDirectory } from "../admin/admin-directory.ts"
import type { ResolvedConfig } from "../config.ts"
import type { StreamerRecord } from "./account-store.ts"

export type StreamerAccessConfig = Pick<ResolvedConfig, "openSignup">

/** Whether the streamer may create giveaways: always while signup is open or for an admin, otherwise once approved. */
export async function canCreateGiveaways(
  config: StreamerAccessConfig,
  admins: Pick<AdminDirectory, "isAdmin">,
  streamer: Pick<StreamerRecord, "platformUserId" | "approvedAt">,
): Promise<boolean> {
  if (config.openSignup || streamer.approvedAt !== null) return true
  return admins.isAdmin(streamer.platformUserId)
}
