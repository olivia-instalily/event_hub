import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { getEventPlanning, type EventPlanning } from "../lib/db";
import { filesFromDrop } from "../lib/drop";
import { ingestEventDoc, completenessFields } from "./EventPlanningPage";
import { BackfillModal } from "./BackfillModal";

// Drop-a-doc-onto-an-event behavior, shared by every list/grid that shows event cards (Events list,
// Home, …). Drop onto a card/row: a PAST event opens the enrich review (bottom pill → review); an
// ACTIVE event gets a quick silent gap-fill. `onChanged` refreshes the caller's list after changes.
export function useEventDrop(onChanged: () => void) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropBusyId, setDropBusyId] = useState<string | null>(null);
  const [dropToast, setDropToast] = useState<string | null>(null);
  const [enrichTarget, setEnrichTarget] = useState<{ plan: EventPlanning; files: File[] } | null>(null);
  useEffect(() => { if (!dropToast) return; const t = setTimeout(() => setDropToast(null), 6000); return () => clearTimeout(t); }, [dropToast]);

  const handleEventDrop = async (id: string, title: string, files: File[]) => {
    if (!files.length) return;
    setDropBusyId(id); setDropToast(null);
    try {
      const plan = await getEventPlanning(id);
      if (!plan) { setDropToast(`${title}: couldn't load the event.`); return; }
      const isPast = plan.settleState === "settled" || plan.macroStage === "Wrapped" || (!!plan.date && plan.date < new Date().toISOString().slice(0, 10));
      if (isPast) { setEnrichTarget({ plan, files }); return; } // enrich review (bottom pill → review)
      const gapKeys = completenessFields(plan).filter((f) => !f.present).map((f) => f.key);
      let applied = 0;
      for (const file of files) { try { const r = await ingestEventDoc(id, file, gapKeys); if (r.applied) applied++; } catch { /* skip one bad file */ } }
      setDropToast(`${title}: processed ${files.length} file${files.length === 1 ? "" : "s"}${applied ? `, ${applied} applied` : " — nothing new"}.`);
      if (applied) onChanged();
    } catch (e: any) { setDropToast(`${title}: ${e?.message ?? String(e)}`); }
    finally { setDropBusyId(null); }
  };

  // Props to spread onto a card/row. data-event-drop lets the app-level "create" overlay hide while
  // over a card; only the DROP stops propagation so it attaches instead of firing the create flow.
  const dropZone = (id: string, title: string) => ({
    "data-event-drop": id,
    onDragEnter: (e: React.DragEvent) => { if (!Array.from(e.dataTransfer.types).includes("Files")) return; e.preventDefault(); setDragOverId(id); },
    onDragOver: (e: React.DragEvent) => { if (!Array.from(e.dataTransfer.types).includes("Files")) return; e.preventDefault(); setDragOverId(id); },
    onDragLeave: () => setDragOverId((cur) => (cur === id ? null : cur)),
    onDrop: (e: React.DragEvent) => { if (!Array.from(e.dataTransfer.types).includes("Files")) return; e.preventDefault(); e.stopPropagation(); setDragOverId(null); void filesFromDrop(e.dataTransfer).then((fs) => { if (fs.length) void handleEventDrop(id, title, fs); }); },
  });

  // The enrich modal (bottom pill) + result toast — render this once in the page.
  const overlays = (
    <>
      {enrichTarget && (
        <BackfillModal
          enrich={{ eventId: enrichTarget.plan.id, plan: enrichTarget.plan }}
          initialFiles={enrichTarget.files}
          startMinimized
          onClose={() => setEnrichTarget(null)}
          onCreated={() => { setEnrichTarget(null); onChanged(); }}
        />
      )}
      {dropToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[95] inline-flex items-center gap-2 bg-gray-900 text-white text-sm px-4 py-2 rounded-full shadow-lg">
          <span>{dropToast}</span>
          <button onClick={() => setDropToast(null)} className="text-gray-400 hover:text-white" aria-label="Dismiss"><X className="w-4 h-4" /></button>
        </div>
      )}
    </>
  );

  return { dropZone, dragOverId, dropBusyId, overlays };
}
