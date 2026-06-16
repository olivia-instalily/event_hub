// Planning schedule logic.
//
// Each planning workstream has a primary "Due" milestone expressed as an offset in days
// from the event date E (negative = before the event). These encode the team's standard
// timeline:
//
//   Venue booking + coord ........ contract + deposit by E − 4 weeks
//   Marketing & promotion ........ registration page live by E − 4 weeks
//   Catering finalization ........ menu + per-head locked by E − 3–4 weeks
//   Talent & moderator outreach .. speakers confirmed by E − 3 weeks
//   AV/V & tech setup ............ vendors/photographer confirmed by E − 3 weeks
//   Guest list & attendee outreach RSVP checkpoint at E − 2 weeks
//   Day-of logistics & staffing .. run-of-show v1 / supplies by E − 2 weeks
//
// The longest lead (venue/marketing) defines the reference window. When the actual
// planning window is shorter than that, every offset is compressed proportionally so the
// sequence still fits the days available — and never lands before the planning start or
// after the event.

const REFERENCE_WINDOW = 28; // days — longest lead time (E − 4 weeks)
const DEFAULT_OFFSET = -14;

// First match wins, so order matters (more specific / longer-lead workstreams first).
const WORKSTREAMS: { rx: RegExp; offsetDays: number }[] = [
  { rx: /venue|space/i, offsetDays: -28 },
  { rx: /market|promo|registration page|reg page|social|comms|content|graphic|brand|identit/i, offsetDays: -28 },
  { rx: /cater|food|menu|beverage|drink/i, offsetDays: -25 },
  { rx: /speaker|talent|moderat|panel/i, offsetDays: -21 },
  { rx: /a\/?v\b|audio|visual|video|tech|production|sound|photo/i, offsetDays: -21 },
  { rx: /attendee|guest|rsvp|invit|outreach/i, offsetDays: -14 },
  { rx: /logistic|day-?of|staff|run-?of-?show|signage|supplies|check-?in|name ?tag/i, offsetDays: -14 },
];

/** The canonical (full-window) due offset for a workstream title. */
export function dueOffsetForWorkstream(title: string): number {
  const hit = WORKSTREAMS.find((w) => w.rx.test(title));
  return hit ? hit.offsetDays : DEFAULT_OFFSET;
}

function daysBetween(aIso: string, bIso: string): number {
  const ms = new Date(bIso + "T00:00:00").getTime() - new Date(aIso + "T00:00:00").getTime();
  return Math.round(ms / 86400000);
}

/**
 * Resolve a workstream title to a due-offset (days before E), compressed to fit a short
 * planning window. `eventDate` and `startDate` are ISO (yyyy-mm-dd); `startDate` is the
 * planning kickoff (usually today). Falls back to the canonical offset when either date
 * is unknown.
 */
export function dueOffsetForTitle(title: string, eventDate: string | null, startDate: string | null): number {
  const base = dueOffsetForWorkstream(title);
  if (!eventDate || !startDate) return base;
  const ramp = daysBetween(startDate, eventDate); // days available to plan
  if (ramp <= 0) return base;
  let offset = ramp < REFERENCE_WINDOW ? Math.round(base * (ramp / REFERENCE_WINDOW)) : base;
  offset = Math.max(offset, -ramp); // not before the planning start
  offset = Math.min(offset, 0); // not after the event
  return offset;
}
