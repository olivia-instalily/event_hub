-- Manual status override for an event. When set (future | in-process | past) it wins
-- over the derived status (macro_stage → in-process, then series, then date). Lets a
-- user mark an event's coarse status from the event page; the UI blocks moving to
-- 'past' before the event date.
alter table event add column status text;

grant update (status) on event to anon, authenticated;
