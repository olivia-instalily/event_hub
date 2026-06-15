-- Make the manually-authored (non-Luma) parts of an event editable from the dashboard.
grant insert, update, delete on reflection to anon, authenticated;
grant insert, update, delete on budget_line to anon, authenticated;
grant update (format, audience, location) on event to anon, authenticated;
