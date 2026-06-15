Data Model v2 — refined against a real event (TTW 2026)

Encoding the TTW 2026 recap into the model surfaced several things the original brief's model couldn't hold cleanly. That's the point of doing a real event first — these are cheap fixes now, expensive later. This doc is the updated model plus the findings, to hand to Claude Code alongside ttw_2026_seed.json.


What the real event exposed (the findings)

1. Events come in umbrellas. Add an Event Series (parent) above Event.
TTW 2026 isn't one event — it's a week-long presence containing two distinct sub-events (Fireside + Roundtables, Happy Hour) plus side activities (hackathon interest, campus walk-throughs). Each sub-event has its own turnout, audience, and format. The original model only had a flat Event. Fix: a Event Series parent that an Event optionally belongs to. Budget and vendor engagements can attach at either level (TTW's costs were reported at the series level, not per sub-event).

2. Turnout is core data the model was missing.
The single most important number in the whole recap — 528 RSVPs against a 120 capacity, 102 checked in, ~200 admitted off waitlist — had nowhere to live. Add a turnout block to Event: rsvp, capacity, checked_in, waitlist_admitted, plus a free-text note (actual attendance was higher than checked-in via plus-ones/walk-ins, which is itself a recurring reality to capture).

3. Attendee↔Event needs a role, not just attendance.
Naveen and Amit weren't attendees, they were the fireside speakers. The link between a person and an event carries a role (speaker, attendee, judge, host). Model the join with a role_at_event field rather than a plain many-to-many.

4. Internal staff are not vendors.
Polina (photography lead) and Riley (in-house video) are Instalily staff who managed vendors — they're not vendors themselves. The model needs a distinction between internal staff and external vendors, or staff get mis-filed into the vendor book. Also: vendors carry a preferred_list flag (the photography vendor → "add to preferred Toronto list") — a real, recurring need.

5. Budget data is messy and won't reconcile to the penny.
Costs were reported by vendor name (Ace, Waterworks, Other), not by clean category, with a catch-all "Other" bucket — and the reported total ($38,482.25) doesn't match the line-item sum ($38,481.88) by $0.37. The model must: allow an uncategorized/"Other" line, link lines to engagements when known, and flag reconciliation gaps rather than assume the math is clean.

6. Missing data is the normal case — every field must be nullable, and gaps must be visible.
No contracts were captured (though venues were paid). No candidate names ("Recruiting Contacts" was empty). No exact dates, no pre-event deliverables (it's a post-hoc recap). The system's value is forcing and preserving exactly this — so nullable fields, plus a UI that surfaces "not captured yet" instead of hiding it.

7. The recap answers its own open question — which validates the recruiting flow.
The doc literally asks "How to tag/flag candidates in the portal?" That's the Greenhouse/recruiting flow already designed: a Hire-typed attendee becomes a prospect tagged with the event. The real workflow pain confirms the integration is worth building.

8. Cross-event attendee overlap is real and worth tracking.
"Significant overlap between Event 1 and Event 2 attendees" is the frequency-tracking feature, observed in the wild. Confirms dedup-by-email + attendance count is load-bearing, not nice-to-have.


The model (v2)

Entities, with the changes above folded in. Bold = new or changed since the brief.


Event Series (new) — optional parent. Fields: name, office, owning_team, type, dates, status, plus rollup notes (verdict, ongoing_motion). Has many Events. Budget/engagements may attach here.
Event — a single gathering. Now belongs optionally to a Series. Fields: name, format, turnout block (rsvp, capacity, checked_in, waitlist_admitted, actual_attendance_note), audience, macro stage, notes. Has many Engagements, Deliverables, and Attendee links.
Event Type (template) — unchanged: vendor categories, deliverables (phase, role, T-offset), budget template (per-category range), carry-forward reflections. Created from scratch or "save as template" from a finished event/series.
Deliverable — title, phase, owner role, due offset → resolved date, status (synced from Linear on live events).
Vendor — persistent across events. Contacts (with emails for matching), category, contract history, activity feed, preferred_list flag.
Engagement — a vendor decision. Now attachable to a Series OR an Event. Candidates+quotes, selected vendor, pipeline stage (Sourced → Quoted → Negotiating → Selected → Contracted), confirmed amount.
Contract — file (object storage) + metadata (vendor, event/series, amount, signed date, expiry, status). Attached to the vendor, referenced by the engagement. (Visibility/permissions = open decision; see brief.)
Budget line — estimated + confirmed amount, linkable to an engagement, with an allowed uncategorized "Other" line and a reconciliation flag.
Attendee — person, deduped by email. Type (Client / Hire / Partner / Investor / Unknown), org, title, attendance frequency.
Attendee–Event link (changed) — join carries role_at_event (attendee / speaker / judge / host).
Staff (new) — internal team members (e.g. Polina, Riley) who own deliverables or manage vendors. Distinct from Attendee and Vendor.


Relationships

Series 1—* Event. Event 1—* Engagement (also Series 1—* Engagement). Engagement —1 Vendor. Vendor 1— Contract. Event — Attendee (through a role-bearing join). Event/Series 1—* Budget line. Event Type 1—* Event (templates spawn events).


How TTW maps in (sanity check)


Series: TTW 2026 (Toronto, Wrapped).
Events: Fireside + Roundtables (528/120/102/~200), Happy Hour (200/—/56).
Speakers: Naveen, Amit (Partner-type attendees, role = speaker on the Fireside).
Partners: Erchit, Naveen, Amit (Google).
Hires: ~20–30 tracked (aggregate for now; names to be filled into individual Attendee records).
Vendors: Ace (venue, $23,401.88, contracted), Waterworks (venue, $10,535, contracted), photography vendor (delivered, name TBD, → preferred list), videographer (in progress).
Budget: series-level, $38,482.25 reported vs $38,481.88 summed → flagged.
Staff: Polina (photo lead), Riley (video/brand).
Reflections: 9 carry-forward notes — these seed the "TTW / flagship" template (AV-vs-presentation check, staff name tags, overflow/waitlist policy, shorter content blocks, acoustics, hackathons, campus booths, camera-with-prompts, preferred photographer).
Contracts: none captured — flagged as a gap to backfill.



Suggested next moves (in build order)


Confirm the v2 model holds (it does for TTW — but pressure-test with a second, different event type if you have one, e.g. a pure hackathon, to check the Series-vs-Event split holds when there's no umbrella).
Translate this into actual schema (tables/columns) for your backend — if BaaS, this is the table definitions; the seed JSON loads as your first records.
Wire the prototype dashboard to read TTW from the DB. The milestone: the dashboard renders the real Toronto event.
Then Luma → backfill the real attendee list (RSVPs + check-ins) against these two events by email. This is also where the ~20–30 candidate names finally get populated as individual Attendee records.