// The default phase set for an event created without explicit phases. A past event only needs the
// post-event Wrap; a future/undated one gets Plan → Day-of → Wrap. (Explicit phases from a brief override this.)
export function defaultPhases(date: string | null): { name: string; order: number }[] {
  const today = new Date().toISOString().slice(0, 10);
  const isPast = !!date && date < today;
  return isPast ? [{ name: "Wrap", order: 0 }] : [{ name: "Plan", order: 0 }, { name: "Day-of", order: 1 }, { name: "Wrap", order: 2 }];
}
