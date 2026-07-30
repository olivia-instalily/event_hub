-- Budget becomes the single cost store: optional categories (with an optional estimate) grouping
-- vendor rows, plus loose lines. Vendors demoted from the engagement store into an optional field on
-- a row. Mirrors the deliverables benchmarks pattern (JSONB list + nullable child id).

alter table budget      add column if not exists categories  jsonb not null default '[]';
alter table budget_line add column if not exists category_id text;   -- null => loose line
alter table budget_line add column if not exists vendor_id   text references vendor(id);
alter table budget_line add column if not exists vendor_name text;    -- denormalized when no vendor row

-- Grants: budget_line already has table-level insert/update/delete (editable-grants migration), which
-- covers the new columns; budget's grants cover its new column. Nothing extra to grant.

-- ── Backfill: each engagement -> a category on its event's budget + a vendor row; each candidate ->
-- a sibling Quoted row. Existing budget_line rows stay loose (category_id null, untouched).
-- Idempotency guard: skip if any categorized line already exists (backfill already ran).
do $$
declare
  e    record;
  bid  text;
  cat_id text;
  cand record;
begin
  if exists (select 1 from budget_line where category_id is not null) then
    return;
  end if;

  for e in
    select en.id, en.event_id, en.category, en.stage, en.confirmed_amount, en.vendor_id,
           v.name as vendor_name
    from engagement en
    left join vendor v on v.id = en.vendor_id
    where en.event_id is not null
  loop
    -- ensure a budget exists for the event
    select id into bid from budget where event_id = e.event_id limit 1;
    if bid is null then
      bid := 'bud_' || substr(md5(random()::text), 1, 12);
      insert into budget (id, event_id, currency, categories) values (bid, e.event_id, 'USD', '[]');
    end if;

    -- find or create a category for this engagement's category name (dedupe case-insensitively)
    cat_id := null;
    if e.category is not null and length(trim(e.category)) > 0 then
      select c->>'id' into cat_id
      from jsonb_array_elements((select categories from budget where id = bid)) c
      where lower(c->>'name') = lower(trim(e.category))
      limit 1;
      if cat_id is null then
        cat_id := 'cat_' || substr(md5(random()::text), 1, 12);
        update budget
          set categories = categories || jsonb_build_array(jsonb_build_object(
            'id', cat_id, 'name', trim(e.category), 'estimate', null,
            'order', jsonb_array_length(categories)))
          where id = bid;
      end if;
    end if;

    -- the engagement itself -> a vendor row (paid when contracted/paid/delivered, else quoted)
    insert into budget_line (id, budget_id, label, confirmed_amount, payment_status,
                             category_id, vendor_id, vendor_name)
    values ('bl_' || substr(md5(random()::text), 1, 12), bid,
            coalesce(e.vendor_name, e.category, 'Vendor'),
            e.confirmed_amount,
            case when lower(coalesce(e.stage,'')) in ('contracted','paid','delivered') then 'paid' else 'quoted' end,
            cat_id, e.vendor_id, e.vendor_name);

    -- competing candidates -> sibling Quoted rows
    for cand in
      select ec.quote_amount, ec.vendor_id, coalesce(vv.name, ec.vendor_name) as vname
      from engagement_candidate ec
      left join vendor vv on vv.id = ec.vendor_id
      where ec.engagement_id = e.id
    loop
      insert into budget_line (id, budget_id, label, confirmed_amount, payment_status,
                               category_id, vendor_id, vendor_name)
      values ('bl_' || substr(md5(random()::text), 1, 12), bid,
              coalesce(cand.vname, 'Quote'), cand.quote_amount, 'quoted',
              cat_id, cand.vendor_id, cand.vname);
    end loop;
  end loop;
end $$;

-- Slack cost captures no longer route to a 'vendor' home; they land as budget rows.
update slack_capture set home = 'budget' where home = 'vendor';
