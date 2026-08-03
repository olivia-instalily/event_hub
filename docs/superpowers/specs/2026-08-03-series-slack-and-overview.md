# Series-level Slack + Series Overview

**Goal:** Attach one Slack channel to a *series* (collective push of grouped events), route each
scraped fact to the right member event when confident (never guess otherwise), and give the series
its own Overview that mirrors an event's Overview across the push.

Builds on the scrape-on-open engine + auto-apply/dedup (committed `c494cbd`).

## Model

**Ingestion unit = the series.**
- `event_series.slack_channel` + `event_series.slack_last_extracted_ts` (marker on the series).
- Scrape resolution: when the opened event's series has a channel → scrape at the series level;
  an event with its *own* `slack_channel` still scrapes per-event (standalone events unchanged).
- One marker, one pull per scrape → no cross-event contamination.

**Roster-aware routing.** Extraction is given the series roster — each member event's id, name, date,
and a one-line descriptor — plus each event's date window as a hint. For every fact it returns a
target: a specific `eventId` (confident) or `"unassigned"` / `"series"` (won't guess / push-wide).
- Confident `eventId` → routed to that event; applies + dedups exactly as today.
- `unassigned` → a series-level capture that waits in the series Open area for the user to assign.
- `series` (genuinely push-wide) → applies to the **series-level** budget/staffing store.

**Series-level store (for push-wide facts):**
- Budget: `budget` may attach to a series (`budget.series_id`, nullable; existing per-event budgets
  unchanged). A series budget holds push-wide lines.
- Staffing: `event_series.staff_roles`, `role_assignments`, `role_slack_refs` (mirror the event columns).

## Series Overview (new section on the series page)

Mirrors an event's Overview **minus Learnings**. Sections:
- **Open** — series-level / unassigned Slack captures with an **assign-to-event** control; already-routed
  captures can be **reassigned** here. Series-level open items.
- **Where things stand** — across the push (member events + their phases/dates).
- **Budget** — a **rollup** across member events' budgets **plus** the series-level lines, drillable into
  each event.
- **Staffing** — merged staffing across events plus series-level roles.
- **Resources** — series-level.

## Sub-slices (each independently testable)

1. **Ingestion + routing (foundation).** Migrations (series channel/marker; `budget.series_id`;
   series staffing columns). Series-scrape resolution. Roster-aware extraction returning per-fact
   target. Confident → event; unassigned/series → series capture store. Verify routing on the real
   Toronto channel with a multi-event roster (driver, no prod writes).
2. **Assign / reassign.** Series capture store + `assign(captureId, eventId)` (routes + applies to the
   event) and `reassign` (pull back to series / move between events). db helpers + list.
3. **Series Overview UI.** New section on the series dashboard: Open (captures + assign/reassign),
   Where-things-stand, Budget rollup, Staffing, Resources. No Learnings.
4. **Series-level budget/staffing store** wired into the Overview rollup + the `series` routing target.

## Definition of done
- A shared channel on a series routes confident facts to the right event, holds the rest for assignment,
  and never double-applies across events. The series Overview shows the push at a glance and is where
  unassigned Slack updates land + get routed. Learnings excluded. tsc clean, cf tests pass, verified on
  the real channel.

## Open decisions (resolved)
- Budget/Staffing on the Overview = **rollup across events + a series-level store** (user, 2026-08-03).
- Series-wide facts live in the **series-level store** (user, 2026-08-03).
- Confident routing only; **never guess** — unassigned facts wait in the series Open assign area (user).
