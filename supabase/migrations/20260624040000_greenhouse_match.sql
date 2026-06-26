-- Greenhouse read-back (layer 1): a THIN status flag per person, matched by email.
-- Deliberately minimal — only a cached status label + the match id + sync time. No stages,
-- notes, interviews, offers, or scores ever land here.
alter table attendee add column if not exists greenhouse_candidate_id text;        -- the email match (null = no match)
alter table attendee add column if not exists application_status     text;        -- 'applied' | 'in_pipeline' | 'hired' (null/none = not an applicant)
alter table attendee add column if not exists greenhouse_last_synced timestamptz;  -- freshness of the cached flag

-- Access gate: the applicant flag is cross-context sensitive — visible only to admins
-- (same control that gates cost/budget visibility). Seed the first profile as admin.
alter table profile add column if not exists is_admin boolean default false;
update profile set is_admin = true where id = (select id from profile order by created_at limit 1);
