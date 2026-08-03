-- Transcript nudge: when an event/meeting has happened, EventHub posts a one-time prompt to the paired
-- channel asking people to drop the transcript/recording (which the scrape then ingests). Sticky so it
-- never re-nags — set once when the prompt is posted.
alter table event add column if not exists transcript_nudged_at timestamptz;
