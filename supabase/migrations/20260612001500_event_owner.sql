-- Let the dashboard set/alter an event's owner (owning team) directly.
grant update (owning_team) on event to anon, authenticated;
