import { useState } from "react";
import { AlertCircle, Plus } from "lucide-react";
import { addDeliverable, type EventPlanning, type Deliverable } from "../lib/db";
import { dueOffsetForTitle } from "../lib/schedule";
import type { Phase } from "../lib/phases";

// Standard deliverables we can guess for any event — surfaced as tentative suggestions
// in the deliverables tab (each addable via +). Titles align with the schedule's workstream offsets.
const TENTATIVE_DELIVERABLES: { title: string; tag: string; phase: Phase }[] = [
  { title: "Book venue & confirm space", tag: "Venue", phase: "planning" },
  { title: "Launch registration page", tag: "Marketing", phase: "planning" },
  { title: "Finalize catering & menu", tag: "Catering", phase: "planning" },
  { title: "Confirm speakers & moderators", tag: "Program", phase: "planning" },
  { title: "Lock A/V & production", tag: "Production", phase: "planning" },
  { title: "Send invites & track RSVPs", tag: "Guests", phase: "planning" },
  { title: "Run-of-show & day-of staffing", tag: "Logistics", phase: "day-of" },
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

  // Scroll to + briefly ring the header date field (inline styles survive re-renders).
  const highlightDateField = () => {
    const el = document.getElementById("hlf-date");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.outline = "2px solid rgb(252 211 77)"; // amber-300
    el.style.outlineOffset = "2px";
    el.style.borderRadius = "6px";
    const clear = () => { el.style.outline = ""; el.style.outlineOffset = ""; el.style.borderRadius = ""; };
    setTimeout(() => document.addEventListener("mousedown", clear, { once: true }), 0);
  };
  // "Set date" → highlight the field AND pop its calendar open (click the DateEdit's calendar button).
  const openDatePicker = () => {
    highlightDateField();
    setTimeout(() => document.querySelector<HTMLButtonElement>('#hlf-date button[aria-label="Open calendar"]')?.click(), 350);
  };

  // Tentative deliverables not yet added — each addable via +.
  const present = new Set(items.map((d) => d.title.toLowerCase().trim()));
  const suggestions = TENTATIVE_DELIVERABLES.filter(
    (s) => !present.has(s.title.toLowerCase()),
  );

  const addSuggestion = async (s: { title: string; tag: string; phase: Phase }) => {
    const due = guessDue(s.title);
    const d = await addDeliverable(eventId, {
      title: s.title,
      phase: s.phase,
      ownerRole: null,
      dueDate: due,
      tags: [s.tag],
    });
    setItems((p) => [...p, d]);
    onApplied();
  };

  const addAll = async () => {
    const created = await Promise.all(
      suggestions.map((s) => addDeliverable(eventId, { title: s.title, phase: s.phase, ownerRole: null, dueDate: guessDue(s.title), tags: [s.tag] })),
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
        <div
          onClick={highlightDateField}
          className="w-full text-left mb-3 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 flex items-center gap-2 hover:bg-amber-100 cursor-pointer"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">
            Set the event date to auto-schedule these — or set any date manually below.{" "}
            <button onClick={(e) => { e.stopPropagation(); openDatePicker(); }} className="underline font-medium hover:text-amber-900">Set date</button>
          </span>
        </div>
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
                {s.tag}
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
