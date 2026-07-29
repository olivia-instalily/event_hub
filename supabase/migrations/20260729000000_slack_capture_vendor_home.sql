-- Add 'vendor' as a capture home — an external supplier being engaged (e.g. a bartending service),
-- distinct from 'person' (an internal staff member filling a role). The extraction guesses, and the
-- user can reclassify a capture's home on the card (person ⇄ vendor ⇄ budget ⇄ open ⇄ plan).
alter table slack_capture drop constraint if exists slack_capture_home_check;
alter table slack_capture add constraint slack_capture_home_check check (home in ('plan','person','vendor','open','budget'));
