import init from "../../schema/room/0001_init.sql" with { type: "text" }
import closedAt from "../../schema/room/0002_closed_at.sql" with { type: "text" }
import commitment from "../../schema/room/0003_commitment.sql" with { type: "text" }
import commitRetry from "../../schema/room/0004_commit_retry.sql" with { type: "text" }
import drawRequested from "../../schema/room/0005_draw_requested.sql" with { type: "text" }
import profileImage from "../../schema/room/0006_profile_image.sql" with { type: "text" }
import metricsReported from "../../schema/room/0007_metrics_reported.sql" with { type: "text" }

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
]
