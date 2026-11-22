-- Aggregate counters for the admin page. No row names or identifies a person.

-- Entries and claims of every room per minute (`minute` is the start of the minute, epoch milliseconds, UTC). Rooms add to it at most once per minute, and the writer deletes rows older than METRICS_RETENTION_HOURS.
CREATE TABLE metrics_minute (
  minute INTEGER PRIMARY KEY,
  entries INTEGER NOT NULL DEFAULT 0 CHECK (entries >= 0),
  claims INTEGER NOT NULL DEFAULT 0 CHECK (claims >= 0)
) WITHOUT ROWID;

-- Home page visits that carried ?ref=<value>, per UTC day (`day` is days since 1970-01-01). The value is a sanitized campaign label, never a visitor.
CREATE TABLE referrals (
  day INTEGER NOT NULL,
  ref TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (day, ref)
) WITHOUT ROWID;

-- The admin page counts giveaways and sign-ups per day and lists the open giveaways.
CREATE INDEX giveaways_by_created ON giveaways (created_at);
CREATE INDEX giveaways_open ON giveaways (created_at) WHERE status = 'open';
CREATE INDEX streamers_by_created ON streamers (created_at);
