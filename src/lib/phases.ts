export type Phase = "planning" | "day-of" | "post";
export const PHASES: Phase[] = ["planning", "day-of", "post"];
export const PHASE_LABEL: Record<Phase, string> = { planning: "Planning", "day-of": "Day-of", post: "Post" };

export type Benchmark = { id: string; name: string; phase: Phase; order: number };

/** Which of the three phases a deliverable falls in, by timing: offset first, else due-vs-event date. */
export function phaseForTiming(offsetStart: number | null, dueDate: string | null, eventDate: string | null): Phase {
  if (offsetStart != null) return offsetStart < 0 ? "planning" : offsetStart === 0 ? "day-of" : "post";
  if (eventDate && dueDate) return dueDate < eventDate ? "planning" : dueDate === eventDate ? "day-of" : "post";
  return "planning";
}

/** Single-select tag filter: click a new tag to select it, click the selected one to clear (all). */
export function nextTagSelection(current: string | null, clicked: string): string | null {
  return current === clicked ? null : clicked;
}
