-- Attendee headshots + per-event speaker tagging (powers the page Speakers grid),
-- manual attendee add from the dashboard, and an editable event cover image.
alter table attendee add column photo_url text;
alter table attendee_event add column speaker_order int;  -- ordering of speakers on the page

-- Manual add + edits from the browser (low-stakes; service-role still does Luma sync).
grant insert on attendee to anon, authenticated;
grant update (photo_url) on attendee to anon, authenticated;
grant insert on attendee_event to anon, authenticated;
grant update (role_at_event, speaker_order) on attendee_event to anon, authenticated;

-- Editable event cover (used on cards + as the page hero default).
grant update (cover_image_url) on event to anon, authenticated;
