// Deep links into specific EventHub views so URLs can be shared. We use QUERY PARAMS (not a hash):
// IAP stores and restores the path + query across the Google login redirect, so a target survives an
// unauthenticated cold click; a hash fragment does not always make the round trip.
//
// Shapes (access is gated by IAP; the id/page is the only thing in the URL — no token / capability):
//   ?event=<id>[&view=budget]    → open that event (view=budget opens the scoping/budget form)
//   ?series=<id>[&tab=<plan|events|people|budget|briefs>] → open that series dashboard
//   ?page=<events|calendar|budget|contacts|people|tutorial|admin|series|home> → a top-level page

export type DeepLinkView = "budget";
// Mirrors App's page union so the two never drift.
export type DeepLinkPage =
  | "home" | "events" | "people" | "vendors" | "contacts" | "budget" | "calendar" | "tutorial" | "admin" | "series";
const PAGES: DeepLinkPage[] = ["home", "events", "people", "vendors", "contacts", "budget", "calendar", "tutorial", "admin", "series"];

export interface DeepLink {
  page: DeepLinkPage | null;
  eventId: string | null;
  seriesId: string | null;
  view: DeepLinkView | null; // event-only: open the scoping/budget form
  tab: string | null;        // optional series (or event) sub-tab
}

/** Parse a location.search string into a DeepLink. Null when it targets nothing. */
export function parseDeepLink(search: string): DeepLink | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  const eventId = params.get("event") || null;
  const seriesId = params.get("series") || null;
  const rawPage = params.get("page");
  const page = rawPage && (PAGES as string[]).includes(rawPage) ? (rawPage as DeepLinkPage) : null;
  if (!eventId && !seriesId && !page) return null;
  return {
    page,
    eventId,
    seriesId,
    view: params.get("view") === "budget" ? "budget" : null,
    tab: params.get("tab") || null,
  };
}

// The current app location, used to keep the address bar in sync so any view is copy-shareable.
export interface AppLocation { page: DeepLinkPage; eventId: string | null; seriesId: string | null; seriesTab?: string | null }

/** Build the "?…" search string for the current location (empty string for the bare Home page).
 *  An open event wins over the series/page; then a selected series; then a plain top-level page. */
export function locationSearch(loc: AppLocation): string {
  const p = new URLSearchParams();
  if (loc.eventId) {
    p.set("event", loc.eventId);
  } else if (loc.page === "series" && loc.seriesId) {
    p.set("series", loc.seriesId);
    if (loc.seriesTab) p.set("tab", loc.seriesTab);
  } else if (loc.page !== "home") {
    p.set("page", loc.page);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Absolute link to a thing, for copy-to-clipboard / embedding (e.g. in a calendar event). */
export function buildAppLink(origin: string, loc: AppLocation): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/${locationSearch(loc)}`;
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
