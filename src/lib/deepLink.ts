// Deep link into a specific event, used by a Slack scoping request so an approver can click
// straight from the message to the budget form. We use QUERY PARAMS (not a hash): IAP stores
// and restores the path + query across the Google login redirect, so the target survives an
// unauthenticated cold click; a hash fragment does not always make the round trip.
//
// Shape: <origin>/?event=<eventId>&view=budget
//   - the id is the only thing in the URL (no token / capability); access is gated by IAP.
//   - view=budget means "open the scoping/budget form", the assign action for that event.

export type DeepLinkView = "budget";

export interface DeepLink {
  eventId: string;
  view: DeepLinkView | null;
}

/** Parse a location.search string into a DeepLink. Null when there's no event id. */
export function parseDeepLink(search: string): DeepLink | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  const eventId = params.get("event");
  if (!eventId) return null;
  return { eventId, view: params.get("view") === "budget" ? "budget" : null };
}

/** Build the absolute deep link posted to Slack: <origin>/?event=<id>&view=budget. */
export function buildEventDeepLink(origin: string, eventId: string, view: DeepLinkView = "budget"): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/?${new URLSearchParams({ event: eventId, view }).toString()}`;
}

// One-shot "open the scoping/budget form for this event" intent. Set by the deep-link resolver
// on app load (App.tsx) and consumed once when that event's Overview mounts. This is a module
// flag rather than a prop because the Overview mounts only AFTER the events list loads — well
// after the initial render and after the URL params have been stripped — so the intent has to
// survive in memory. Consuming clears it, so revisiting the same event later doesn't re-open
// the form.
let pendingScopingEventId: string | null = null;

export function setPendingScopingBudget(eventId: string | null): void {
  pendingScopingEventId = eventId;
}

/** Peek the pending deep-link event id WITHOUT clearing it (routing uses this to send a budget
 *  deep-link straight to the planning view, where the scoping form lives). */
export function peekPendingScopingBudget(): string | null {
  return pendingScopingEventId;
}

/** Returns true (and clears the intent) exactly once, for the event that was deep-linked. */
export function takePendingScopingBudget(eventId: string): boolean {
  if (pendingScopingEventId !== null && pendingScopingEventId === eventId) {
    pendingScopingEventId = null;
    return true;
  }
  return false;
}
