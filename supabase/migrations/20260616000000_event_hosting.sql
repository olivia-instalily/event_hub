-- How InstaLILY relates to an event, captured at create time:
--   'solo'      → we plan/host it alone
--   'cohost'    → we co-host (sharing hosting & cost) with another org (co_host = their name)
--   'attending' → a third party owns it; we attend / exhibit / sponsor
alter table event add column hosting text;   -- solo | cohost | attending
alter table event add column co_host text;    -- partner org name when hosting = 'cohost'

grant update (hosting, co_host) on event to anon, authenticated;
