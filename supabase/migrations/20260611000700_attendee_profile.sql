-- Richer attendee profile (from Luma registration answers + manual context).
alter table attendee add column school text;
alter table attendee add column city text;
alter table attendee add column industry text;
alter table attendee add column linkedin_url text;

-- The dashboard (anon) can edit free-text context: notes + a manually-added LinkedIn.
grant update (note, linkedin_url) on attendee to anon, authenticated;
