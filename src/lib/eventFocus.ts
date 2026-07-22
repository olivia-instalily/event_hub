// What is this event FOR — hiring, client, or neither? Drives how the post-event "measure
// turnout" view frames success (candidate signal vs. client signal vs. plain engagement) and
// which tagging lens surfaces first. A run club is "neither": engagement matters, not triage.
//
// Keyword-based off the event's tags (+ optional format). Defaults to "neither" — we only
// claim a hiring/client focus when the event clearly signals one.
export type EventFocus = "hiring" | "client" | "neither";

const HIRING = /recruit|hir(e|ing)|talent|fireside|campus|career|candidate|intern/i;
const CLIENT = /client|gtm|sales|customer|prospect|account|exec|briefing|partner|sponsor/i;

// A human-set override always wins over the keyword guess (so a mis-matched event can be corrected).
// override null/undefined → auto: fall back to the tag/format classifier.
export function eventFocus(tags: string[], format?: string | null, override?: EventFocus | null): EventFocus {
  if (override === "hiring" || override === "client" || override === "neither") return override;
  const hay = [...(tags ?? []), format ?? ""].join(" ").toLowerCase();
  if (HIRING.test(hay)) return "hiring";
  if (CLIENT.test(hay)) return "client";
  return "neither";
}

export const FOCUS_LABEL: Record<EventFocus, string> = {
  hiring: "Hiring-focused",
  client: "Client / conference",
  neither: "Community — engagement, not triage",
};
