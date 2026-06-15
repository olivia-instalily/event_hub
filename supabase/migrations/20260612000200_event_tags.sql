-- Events can carry multiple tags (incl. custom/manual ones). Array replaces single `tag`.
alter table event add column tags text[] not null default '{}';

-- Migrate the existing single tag into the array.
update event set tags = array[tag] where tag is not null and tag <> '';

grant update (tags) on event to anon, authenticated;
