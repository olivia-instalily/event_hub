-- Link vendor candidates that were created without a directory vendor (e.g. via the Slack capture
-- path, which used to pass no vendor_id) so they show on the Vendors page under their events.
-- 1) create a vendor row for each distinct candidate name that has no matching vendor yet.
insert into vendor (id, name)
select 'vend-bf-' || md5(lower(trim(s.vn))), s.vn
from (
  select distinct trim(vendor_name) as vn
  from engagement_candidate
  where vendor_id is null and coalesce(trim(vendor_name), '') <> ''
) s
where not exists (select 1 from vendor v where lower(trim(v.name)) = lower(trim(s.vn)))
on conflict (id) do nothing;

-- 2) point each unlinked candidate at the vendor matching its name (case-insensitive).
update engagement_candidate ec
set vendor_id = v.id
from vendor v
where ec.vendor_id is null
  and coalesce(trim(ec.vendor_name), '') <> ''
  and lower(trim(v.name)) = lower(trim(ec.vendor_name));
