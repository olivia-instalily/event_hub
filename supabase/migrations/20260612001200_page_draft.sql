-- No-code event page builder: editable draft content (copy + gallery images +
-- section visibility) lives here as JSON. Factual fields (date, location, cover,
-- Luma) stay data-bound and are read live from the event.
alter table event add column page_draft jsonb;

grant update (page_draft) on event to anon, authenticated;
