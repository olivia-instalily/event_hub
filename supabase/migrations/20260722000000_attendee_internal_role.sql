-- Internal people + their crew role, as first-class attendee columns.
--
-- `is_internal`: an attendee is internal either automatically (an @instalily.ai email) or because
-- someone added them as internal by hand (email may then be edited to anything). The column captures
-- the explicit/manual case; the app also treats any @instalily.ai email as internal at read time.
--
-- `crew_role`: the person's stable role, shared with the series roster taxonomy
-- (eng | growth | marketing | leadership | none — see src/lib/campaign.ts CrewRole).
ALTER TABLE attendee ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;
ALTER TABLE attendee ADD COLUMN IF NOT EXISTS crew_role text NOT NULL DEFAULT 'none';

-- Backfill: existing InstaLILY staff (matched by email domain) become internal.
UPDATE attendee SET is_internal = true WHERE email ILIKE '%@instalily.ai';

GRANT UPDATE (is_internal, crew_role) ON attendee TO anon, authenticated;
