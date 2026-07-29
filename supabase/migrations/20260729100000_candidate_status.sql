-- Per-vendor status. Previously a single engagement.stage "decreed" the status for the whole
-- category decision; now each candidate carries its own: sourced → quoted → paid. Multiple vendors
-- can be paid. The engagement's stage stays derived from its candidates (furthest-along).
alter table engagement_candidate add column if not exists status text not null default 'sourced';

-- Backfill from the old engagement-level stage + selection:
--   selected candidate of a Contracted engagement → paid; anything with a quote → quoted; else sourced.
update engagement_candidate ec set status = case
  when e.stage = 'Contracted' and ec.is_selected then 'paid'
  when ec.quote_amount is not null then 'quoted'
  else 'sourced'
end
from engagement e
where e.id = ec.engagement_id;
