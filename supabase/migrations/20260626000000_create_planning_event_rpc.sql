-- Atomic create for a planned event + its template-derived children. Previously this was 4+
-- sequential client inserts (event → engagements → budget → budget_lines → deliverables); a
-- failure partway left orphaned rows committed. A plpgsql function runs in a single implicit
-- transaction, so any error here rolls back ALL inserts.
--
-- Business logic (offsets, format canonicalization, the locked post-mortem) stays client-side;
-- this function just performs the multi-table insert atomically. Explicit column lists (not
-- jsonb_populate_record) so unlisted columns keep their defaults (created_at, page_ownership…).

create or replace function create_planning_event(
  p_event        jsonb,
  p_engagements  jsonb,
  p_budget       jsonb,
  p_budget_lines jsonb,
  p_deliverables jsonb
) returns text
language plpgsql
as $$
declare
  v_event_id text := p_event->>'id';
begin
  insert into event (
    id, name, event_date, location, format, start_time, end_time,
    phases, planning_lead_time, agenda, staff_roles, reflections, walkthrough, heuristics, outreach,
    is_template, tags, macro_stage, modeled_on_event_id, hosting, co_host
  )
  select e.id, e.name, e.event_date, e.location, e.format, e.start_time, e.end_time,
    coalesce(e.phases, '[]'::jsonb), e.planning_lead_time, coalesce(e.agenda, '[]'::jsonb),
    coalesce(e.staff_roles, '[]'::jsonb), coalesce(e.reflections, '[]'::jsonb),
    coalesce(e.walkthrough, '[]'::jsonb), coalesce(e.heuristics, '[]'::jsonb), coalesce(e.outreach, '[]'::jsonb),
    coalesce(e.is_template, false), coalesce(e.tags, '{}'::text[]), e.macro_stage, e.modeled_on_event_id, e.hosting, e.co_host
  from jsonb_to_record(p_event) as e(
    id text, name text, event_date date, location text, format text, start_time text, end_time text,
    phases jsonb, planning_lead_time text, agenda jsonb, staff_roles jsonb, reflections jsonb,
    walkthrough jsonb, heuristics jsonb, outreach jsonb,
    is_template boolean, tags text[], macro_stage text, modeled_on_event_id text, hosting text, co_host text
  );

  insert into engagement (id, event_id, category, stage)
  select x.id, x.event_id, x.category, x.stage
  from jsonb_to_recordset(coalesce(p_engagements, '[]'::jsonb)) as x(id text, event_id text, category text, stage text);

  insert into budget (id, event_id, currency)
  select b.id, b.event_id, coalesce(b.currency, 'USD')
  from jsonb_to_record(p_budget) as b(id text, event_id text, currency text);

  insert into budget_line (id, budget_id, label, confirmed_amount)
  select x.id, x.budget_id, x.label, x.confirmed_amount
  from jsonb_to_recordset(coalesce(p_budget_lines, '[]'::jsonb)) as x(id text, budget_id text, label text, confirmed_amount numeric);

  insert into deliverable (id, event_id, title, phase, status, due_offset_days, offset_start, resolved_due_date, locked)
  select x.id, x.event_id, x.title, x.phase, coalesce(x.status, 'Todo'),
    x.due_offset_days, x.offset_start, x.resolved_due_date, coalesce(x.locked, false)
  from jsonb_to_recordset(coalesce(p_deliverables, '[]'::jsonb)) as x(
    id text, event_id text, title text, phase text, status text,
    due_offset_days int, offset_start int, resolved_due_date date, locked boolean
  );

  return v_event_id;
end;
$$;

grant execute on function create_planning_event(jsonb, jsonb, jsonb, jsonb, jsonb) to anon, authenticated;
