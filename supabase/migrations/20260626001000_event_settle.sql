-- v1 item 1: wrap & write-back model.
-- Settling lifecycle (just_wrapped → debriefed → settled), a first-class recorded outcome,
-- and persisted debrief notes (kept as event project knowledge). Plus an atomic settle that
-- carries the event's confirmed reflections back to the template it was modeled on.

alter table event add column if not exists settle_state text
  check (settle_state in ('just_wrapped', 'debriefed', 'settled'));
alter table event add column if not exists settled_at timestamptz;
alter table event add column if not exists verdict text;        -- the recorded outcome / one-line verdict
alter table event add column if not exists debrief_notes text;  -- raw debrief notes, kept as project knowledge

-- Settle atomically: mark the event settled + merge its reflections into the modeled-on
-- template's reflections (deduped). Returns how many reflections were newly carried over.
-- A plpgsql function is one transaction, so the event update + template write-back can't
-- partially apply.
create or replace function settle_event(p_event_id text)
returns jsonb
language plpgsql
as $$
declare
  v_refl     jsonb;
  v_template text;
  v_existing jsonb;
  v_merged   jsonb;
  v_carried  int := 0;
begin
  select coalesce(reflections, '[]'::jsonb), modeled_on_event_id
    into v_refl, v_template
  from event where id = p_event_id;

  update event set settle_state = 'settled', settled_at = now() where id = p_event_id;

  if v_template is not null and jsonb_array_length(v_refl) > 0 then
    v_existing := coalesce((select reflections from event where id = v_template), '[]'::jsonb);
    -- dedup union of template's reflections + this event's reflections
    select coalesce(jsonb_agg(distinct x), '[]'::jsonb) into v_merged
    from (
      select jsonb_array_elements_text(v_existing) as x
      union
      select jsonb_array_elements_text(v_refl) as x
    ) u;
    v_carried := jsonb_array_length(v_merged) - jsonb_array_length(v_existing); -- # newly added
    update event set reflections = v_merged where id = v_template;
  end if;

  return jsonb_build_object('settled', true, 'template', v_template, 'reflectionsCarried', coalesce(v_carried, 0));
end;
$$;

grant execute on function settle_event(text) to anon, authenticated;
