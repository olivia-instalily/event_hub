import { useState } from "react";
import { AlertCircle, Plus } from "lucide-react";
import { addDeliverable, type EventPlanning, type Deliverable } from "../lib/db";
import { dueOffsetForTitle } from "../lib/schedule";

// Standard deliverables we can guess for any event — surfaced as tentative suggestions
// in the deliverables tab (each addable via +). Titles align with the schedule's workstream offsets.
const TENTATIVE_DELIVERABLES: { title: string; phase: string }[] = [
  { title: "Book venue & confirm space", phase: "Venue" },
  { title: "Launch registration page", phase: "Marketing" },
  { title: "Finalize catering & menu", phase: "Catering" },
  { title: "Confirm speakers & moderators", phase: "Program" },
  { title: "Lock A/V & production", phase: "Production" },
  { title: "Send invites & track RSVPs", phase: "Guests" },
  { title: "Run-of-show & day-of staffing", phase: "Logistics" },
];

export function SuggestedDeliverables({
  plan,
  eventId,
  onApplied,
}: {
  plan: EventPlanning;
  eventId: string;
  onApplied: () => void;
}) {
  const [items, setItems] = useState<Deliverable[]>(plan.deliverables);

  // Guessed due date for a title: event date shifted by the standard offset.
  const guessDue = (title: string): string | null => {
    if (!plan.date) return null;
    const today = new Date().toISOString().slice(0, 10);
    const offset = dueOffsetForTitle(title, plan.date, today);
    const d = new Date(plan.date + "T00:00:00");
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  // Tentative deliverables not yet added — each addable via +.
  const present = new Set(items.map((d) => d.title.toLowerCase().trim()));
  const suggestions = TENTATIVE_DELIVERABLES.filter(
    (s) => !present.has(s.title.toLowerCase()),
  );

  const addSuggestion = async (s: { title: string; phase: string }) => {
    const due = guessDue(s.title);
    const d = await addDeliverable(eventId, {
      title: s.title,
      phase: s.phase,
      ownerRole: null,
      dueDate: due,
    });
    setItems((p) => [...p, d]);
    onApplied();
  };

  const addAll = async () => {
    const created = await Promise.all(
      suggestions.map((s) => addDeliverable(eventId, { title: s.title, phase: s.phase, ownerRole: null, dueDate: guessDue(s.title) })),
    );
    setItems((p) => [...p, ...created]);
    onApplied();
  };

  if (suggestions.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-border p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-gray-800">Suggested deliverables</h3>
        <button
          onClick={addAll}
          className="inline-flex items-center gap-1 px-2 py-1 text-[15px] bg-gray-900 text-white rounded hover:bg-black shrink-0"
        >
          <Plus className="w-3.5 h-3.5" /> Add all
        </button>
      </div>

      {!plan.date && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="w-full text-left mb-3 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 inline-flex items-center gap-2 hover:bg-amber-100"
        >
          <AlertCircle className="w-4 h-4 shrink-0" /> Set the event date to
          auto-schedule these — or set any date manually below.{" "}
          <span className="underline">Set date</span>
        </button>
      )}

      <div className="rounded-lg border border-dashed border-gray-200 divide-y divide-gray-100">
        {suggestions.map((s) => (
          <div
            key={s.title}
            className="px-3 py-2 flex items-center justify-between gap-3 text-sm"
          >
            <div className="min-w-0">
              <p className="truncate text-gray-500">{s.title}</p>
              <p className="text-[15px] text-gray-400">
                {s.phase}
                {plan.date ? ` · ~${guessDue(s.title)}` : ""}
              </p>
            </div>
            <button
              onClick={() => addSuggestion(s)}
              className="inline-flex items-center gap-1 px-2 py-1 text-[15px] bg-gray-200 rounded hover:bg-gray-300 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
