// The default phase set for an event created without explicit phases. The canonical arc is exactly
// three phases: Planning → Day-of → Post. A past event only needs Post. (Explicit phases from a
// brief override this.)
export function defaultPhases(date: string | null): { name: string; order: number }[] {
  const today = new Date().toISOString().slice(0, 10);
  const isPast = !!date && date < today;
  return isPast ? [{ name: "Post", order: 0 }] : [{ name: "Planning", order: 0 }, { name: "Day-of", order: 1 }, { name: "Post", order: 2 }];
}
