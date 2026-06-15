-- Let the dashboard create events (and their budget) from the create-event flow.
-- engagement / budget_line / deliverable already have insert grants; event + budget
-- are the missing pieces. Low-stakes inserts via the API contract (Supabase).
grant insert on event to anon, authenticated;
grant insert on budget to anon, authenticated;
