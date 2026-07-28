import { useState } from "react";
import { updateEventStatus, type EventStatus } from "../lib/db";

const LABELS: Record<EventStatus, string> = { future: "Future", "in-process": "In-Process", past: "Past" };
const DOT: Record<EventStatus, string> = { future: "bg-blue-500", "in-process": "bg-amber-500", past: "bg-gray-400" };
const ORDER: EventStatus[] = ["future", "in-process", "past"];

const todayStr = () => new Date().toISOString().slice(0, 10);

/**
 * Shows what an event is marked as and lets it change. Moving to Past is blocked
 * while today is still before the event date (can't end an event early).
 */
export function StatusControl({ eventId, status, eventDate, onChange, showLabel = true }: {
  eventId: string;
  status: EventStatus;
  eventDate: string | null;
  onChange?: (s: EventStatus) => void;
  showLabel?: boolean;
}) {
  const [cur, setCur] = useState<EventStatus>(status);
  const [open, setOpen] = useState(false);
  const prematurePast = !!eventDate && todayStr() < eventDate;

  const pick = async (s: EventStatus) => {
    if (s === "past" && prematurePast) return;
    setOpen(false);
    if (s === cur) return;
    setCur(s);
    onChange?.(s);
    await updateEventStatus(eventId, s);
  };

  return (
    <div className="relative inline-block">
      {showLabel && <span className="text-[15px] text-gray-500 mr-2">Marked as</span>}
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-gray-300 text-sm hover:bg-gray-50"
      >
        <span className={`w-2 h-2 rounded-full ${DOT[cur]}`} />
        {LABELS[cur]}
        <span className="text-gray-400">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 left-0 mt-1 w-40 bg-white border border-border rounded-lg shadow-lg p-1">
            {ORDER.map((s) => {
              const disabled = s === "past" && prematurePast;
              return (
                <button
                  key={s}
                  onClick={() => pick(s)}
                  disabled={disabled}
                  title={disabled ? "Can't mark Past before the event date" : undefined}
                  className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded text-sm ${
                    disabled ? "text-gray-300 cursor-not-allowed" : "hover:bg-gray-50"
                  } ${s === cur ? "font-medium" : ""}`}
                >
                  <span className={`w-2 h-2 rounded-full ${DOT[s]}`} />
                  {LABELS[s]}
                  {s === cur && <span className="ml-auto text-gray-400">✓</span>}
                </button>
              );
            })}
            {prematurePast && <p className="px-2 py-1 text-[15px] text-gray-400">Past unlocks after {eventDate}.</p>}
          </div>
        </>
      )}
    </div>
  );
}
