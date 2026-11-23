import init from "../../schema/room/0001_init.sql" with { type: "text" }
import closedAt from "../../schema/room/0002_closed_at.sql" with { type: "text" }
import commitment from "../../schema/room/0003_commitment.sql" with { type: "text" }
import commitRetry from "../../schema/room/0004_commit_retry.sql" with { type: "text" }
import drawRequested from "../../schema/room/0005_draw_requested.sql" with { type: "text" }
import profileImage from "../../schema/room/0006_profile_image.sql" with { type: "text" }
import metricsReported from "../../schema/room/0007_metrics_reported.sql" with { type: "text" }
import winnerNames from "../../schema/room/0008_winner_names.sql" with { type: "text" }
import drawCount from "../../schema/room/0009_draw_count.sql" with { type: "text" }
import actors from "../../schema/room/0010_actors.sql" with { type: "text" }
import excludedUsers from "../../schema/room/0011_excluded_users.sql" with { type: "text" }
import chatEntry from "../../schema/room/0012_chat_entry.sql" with { type: "text" }
import winnerForm from "../../schema/room/0013_winner_form.sql" with { type: "text" }
import channelEntry from "../../schema/room/0014_channel_entry.sql" with { type: "text" }
import chatWatched from "../../schema/room/0015_chat_watched.sql" with { type: "text" }
import entryWayRefusal from "../../schema/room/0016_entry_way_refusal.sql" with { type: "text" }
import memberGroup from "../../schema/room/0017_member_group.sql" with { type: "text" }
import rolesPaused from "../../schema/room/0018_roles_paused.sql" with { type: "text" }

/**
 * The room schema files in application order; file `NNNN_*.sql` is entry NNNN - 1. An entry never leaves
 * this list: a database that applied it refuses older code (see `applyMigrations`).
 */
export const roomMigrations: readonly string[] = [
  init,
  closedAt,
  commitment,
  commitRetry,
  drawRequested,
  profileImage,
  metricsReported,
  winnerNames,
  drawCount,
  actors,
  excludedUsers,
  chatEntry,
  winnerForm,
  channelEntry,
  chatWatched,
  entryWayRefusal,
  memberGroup,
  rolesPaused,
]
