-- YouTube Data API units the install spent on each day of Google's quota, which resets at midnight Pacific time. `day` is that date in America/Los_Angeles as YYYY-MM-DD. A call adds its units before it is sent, and a call that would pass YOUTUBE_DAILY_QUOTA_UNITS is not sent, so `units` stays within the cap of the time it was written.
CREATE TABLE youtube_quota_days (
  day TEXT PRIMARY KEY,
  units INTEGER NOT NULL CHECK (units >= 0)
);
