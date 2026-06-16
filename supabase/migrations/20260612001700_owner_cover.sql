-- Event owner as a profile assignment, and a Luma/custom cover split with a toggle.
alter table event add column owner_profile_id text references profile(id) on delete set null;
alter table event add column luma_cover_url text;    -- Luma-provided cover
alter table event add column custom_cover_url text;   -- user-uploaded alternative
-- cover_image_url stays the ACTIVE/displayed cover (everything already reads it).

grant update (owner_profile_id, luma_cover_url, custom_cover_url) on event to anon, authenticated;
