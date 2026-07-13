-- Luma-drawn events now START in 'Concept' (→ status "future") and only graduate to 'Planning'
-- (→ "in-process") once the essentials setup flow is completed. Earlier the background sync imported
-- them straight into 'Planning', so they wrongly showed as in-process on arrival.
--
-- Reset those to 'Concept' — but ONLY the untouched ones: linked to Luma, setup not completed, still
-- in 'Planning'. An event someone has already set up (setup_complete) or pushed past Planning is left
-- exactly where it is.
UPDATE event
SET macro_stage = 'Concept'
WHERE luma_event_id IS NOT NULL
  AND macro_stage = 'Planning'
  AND coalesce(setup_complete, false) = false;
