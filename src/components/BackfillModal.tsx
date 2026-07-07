import { useEffect, useRef, useState, type ReactNode } from "react";
import { Paperclip, Loader2, Check, X, AlertCircle } from "lucide-react";
import {
  extractForBackfill, listTemplates, backfillWrappedEvent, createTemplateFromExtract, applyTemplateAdditions,
  uploadDocument, setEventMaterials, type SourceMaterial,
} from "../lib/db";
import {
  matchTemplates, completenessGaps, templateAdditions, hasAdditions,
  type BackfillExtract, type TemplateLite, type TemplateMatch, type Gap, type TemplateAdditions,
} from "../lib/backfill";
import { unsupportedFileMessage, isWorkbookFile } from "../lib/fileSupport";

// Backfill a past event by dropping its debrief/brief. Extract → classify + match a template
// (propose, don't auto-merge) → completeness prompt (not a block) → create the wrapped record,
// adopt/extend the one template. No-propagation: extending a template never rewrites siblings.
type Choice = string; // template id | "new" | "none"

export function BackfillModal({ onClose, onCreated, initialText, initialFiles }: { onClose: () => void; onCreated: (eventId: string) => void; initialText?: string; initialFiles?: File[] | null }) {
  const [stage, setStage] = useState<"input" | "extracting" | "review" | "saving">("input");
  const [text, setText] = useState(initialText ?? "");
  // The dropped file(s) that generated this backfill → kept as tagged source materials.
  const [attachFiles, setAttachFiles] = useState<File[]>(initialFiles ?? []);
  const [over, setOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [x, setX] = useState<BackfillExtract | null>(null);
  const [templates, setTemplates] = useState<TemplateLite[]>([]);
  const [matches, setMatches] = useState<TemplateMatch[]>([]);
  const [choice, setChoice] = useState<Choice>("new");
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [tmplQuery, setTmplQuery] = useState(""); // search OTHER templates by name (don't list them all)
  const [excluded, setExcluded] = useState<Set<string>>(new Set()); // addition items the user unchecked
  const [fills, setFills] = useState<{ date: string; turnout: string; budget: string; outcome: string }>({ date: "", turnout: "", budget: "", outcome: "" });

  const fileRef = useRef<HTMLInputElement>(null);
  const readFile = async (file?: File | null) => {
    if (!file) return;
    const bad = unsupportedFileMessage(file);
    if (bad) { setErr(bad); return; }
    try {
      // Workbooks (.xlsx/.ods): flatten every tab into one labeled text blob for the extractor.
      const content = isWorkbookFile(file)
        ? await (await import("../lib/workbook")).readWorkbookAsText(file)
        : await file.text();
      setText(content); setAttachFiles([file]);
    } catch { setErr("Couldn't read that file — paste the text instead."); }
  };

  // Handed text from the create flow (a dropped past-event brief) → process it straight away.
  useEffect(() => { if (initialText?.trim()) void run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const run = async () => {
    if (!text.trim()) return;
    setStage("extracting"); setErr(null);
    try {
      const [ex, tmpls] = await Promise.all([extractForBackfill(text), listTemplates()]);
      const ms = matchTemplates(tmpls, { format: ex.format, tag: ex.tag });
      const { gaps } = completenessGaps(ex);
      setX(ex); setTemplates(tmpls); setMatches(ms); setGaps(gaps);
      setChoice(ms[0] && ms[0].score >= 3 ? ms[0].template.id : "new"); // pre-select strong match; confirm on create
      setStage("review");
    } catch (e: any) { setErr(e?.message ?? String(e)); setStage("input"); }
  };

  const chosenTemplate = templates.find((t) => t.id === choice) ?? null;
  const adds: TemplateAdditions | null = chosenTemplate && x ? templateAdditions(chosenTemplate, x) : null;
  const addKey = (kind: string, v: string) => `${kind}:${v}`;
  const toggleAdd = (k: string) => setExcluded((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const selectedAdds = (): TemplateAdditions => ({
    phases: (adds?.phases ?? []).filter((v) => !excluded.has(addKey("phase", v))),
    roles: (adds?.roles ?? []).filter((v) => !excluded.has(addKey("role", v))),
    lessons: (adds?.lessons ?? []).filter((v) => !excluded.has(addKey("lesson", v))),
  });

  const create = async () => {
    if (!x) return;
    setStage("saving"); setErr(null);
    try {
      const merged: BackfillExtract = {
        ...x,
        date: fills.date || x.date,
        turnoutActual: fills.turnout !== "" ? Number(fills.turnout) : x.turnoutActual,
        budgetTotal: fills.budget !== "" ? Number(fills.budget) : x.budgetTotal,
        verdict: fills.outcome || x.verdict,
      };
      let templateId: string | null = null;
      if (choice === "new") templateId = await createTemplateFromExtract(merged);
      else if (choice !== "none") {
        templateId = choice;
        const sel = selectedAdds();
        if (hasAdditions(sel)) await applyTemplateAdditions(choice, sel);
      }
      const eventId = await backfillWrappedEvent(merged, templateId);
      // Keep the file(s) that generated this backfill as tagged source materials.
      if (attachFiles.length) {
        const materials: SourceMaterial[] = [];
        for (const f of attachFiles) {
          try { const url = await uploadDocument(f); materials.push({ name: f.name, url, type: f.type || "text/plain" }); } catch { /* non-fatal */ }
        }
        if (materials.length) { try { await setEventMaterials(eventId, materials); } catch { /* non-fatal */ } }
      }
      onCreated(eventId);
    } catch (e: any) { setErr(e?.message ?? String(e)); setStage("review"); }
  };

  const field = "px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
      // Keep drags inside the modal — don't let them bubble to the app-level "drop to create" overlay.
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDragLeave={(e) => { e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <div className="bg-white rounded-2xl border border-border max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xl">Backfill a past event</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-gray-500 mb-4">Drop its debrief or brief. EventHub creates the wrapped record, fills what it can, and builds on the matching template. Nothing's created until you confirm.</p>

        {(stage === "input" || stage === "extracting") && (
          <div className="space-y-3">
            <div
              onClick={() => fileRef.current?.click()}
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
              onDragLeave={(e) => { e.stopPropagation(); setOver(false); }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); void readFile(e.dataTransfer.files?.[0]); }}
              className={`rounded-xl border-2 border-dashed p-6 text-center text-sm cursor-pointer transition-colors ${over ? "border-gray-800 bg-gray-50 text-gray-800" : "border-gray-300 text-gray-500 hover:bg-gray-50"}`}
            >
              <Paperclip className="w-5 h-5 mx-auto mb-1 text-gray-400" />
              Drop a debrief or brief (.txt/.vtt), or click to choose — or paste below.
              <input ref={fileRef} type="file" hidden onChange={(e) => { void readFile(e.target.files?.[0]); e.currentTarget.value = ""; }} />
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="…or paste the debrief / brief text" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <div className="flex items-center gap-2">
              <button onClick={run} disabled={stage === "extracting" || !text.trim()} className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-black disabled:opacity-50 inline-flex items-center gap-1">
                {stage === "extracting" ? <><Loader2 className="w-4 h-4 animate-spin" /> Reading…</> : "Process"}
              </button>
              {err && <span className="text-sm text-red-600">{err}</span>}
            </div>
          </div>
        )}

        {stage !== "input" && stage !== "extracting" && x && (
          <div className="space-y-5">
            {/* extracted summary */}
            <div className="rounded-xl border border-gray-200 p-4 text-sm">
              <p className="font-medium">{x.name || "Untitled event"}</p>
              <p className="text-gray-500 mt-0.5">{[x.format, x.date, x.location, x.tag].filter(Boolean).join(" · ") || "—"}</p>
              {x.verdict && <p className="text-gray-600 mt-1">“{x.verdict}”</p>}
            </div>

            {/* template match — suggest only RELEVANT templates; search for any other. */}
            {(() => {
              const relevant = matches.filter((m) => m.score >= 2); // meaningful type overlap only
              const relevantIds = new Set(relevant.map((m) => m.template.id));
              const q = tmplQuery.trim().toLowerCase();
              const found = q ? templates.filter((t) => t.name.toLowerCase().includes(q) && !relevantIds.has(t.id)) : [];
              const Row = ({ id, label }: { id: string; label: ReactNode }) => (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="tmpl" checked={choice === id} onChange={() => setChoice(id)} />
                  <span>{label}</span>
                </label>
              );
              return (
                <div>
                  <p className="text-[13px] font-medium text-gray-700 mb-1">Template</p>
                  <div className="space-y-1.5">
                    {relevant.map((m) => <Row key={m.template.id} id={m.template.id} label={<>Build on <span className="font-medium">{m.template.name}</span>{m.template.format ? ` (${m.template.format})` : ""}</>} />)}
                    {relevant.length === 0 && <p className="text-[12px] text-gray-400">No matching template — create one below, or search.</p>}
                    {/* search for a different template (the list will grow — don't enumerate all) */}
                    <input value={tmplQuery} onChange={(e) => setTmplQuery(e.target.value)} placeholder="Search other templates…" className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                    {found.map((t) => <Row key={t.id} id={t.id} label={<>Build on <span className="font-medium">{t.name}</span>{t.format ? ` (${t.format})` : ""}</>} />)}
                    {q && found.length === 0 && <p className="text-[12px] text-gray-400">No other template matches “{tmplQuery}”.</p>}
                    <Row id="new" label={<>Create a new {x.format || "event"} template</>} />
                    <Row id="none" label="Standalone — no template" />
                  </div>
                </div>
              );
            })()}

            {/* propose additions to an existing template */}
            {adds && hasAdditions(adds) && (
              <div>
                <p className="text-[13px] font-medium text-gray-700 mb-1">Add to <span className="font-semibold">{chosenTemplate!.name}</span> <span className="text-gray-400 font-normal">· this event surfaced things the template lacks</span></p>
                <div className="space-y-1">
                  {([["phase", adds.phases], ["role", adds.roles], ["lesson", adds.lessons]] as const).flatMap(([kind, items]) =>
                    items.map((v) => {
                      const k = addKey(kind, v);
                      return (
                        <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input type="checkbox" checked={!excluded.has(k)} onChange={() => toggleAdd(k)} />
                          <span className="text-gray-400 text-[11px] uppercase w-12 shrink-0">{kind}</span>
                          <span className="flex-1">{v}</span>
                        </label>
                      );
                    }),
                  )}
                </div>
              </div>
            )}

            {/* completeness — prompt, not block */}
            {gaps.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-[13px] font-medium text-amber-900 inline-flex items-center gap-1.5 mb-1"><AlertCircle className="w-4 h-4" /> What would make this a complete record</p>
                <p className="text-[12px] text-amber-700 mb-2">Optional — you can create it now and fill these later, or drop a fuller brief.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5">
                  {gaps.map((g) => (
                    <div key={g.field} className="flex flex-col gap-1 min-w-0">
                      <span className="text-[13px] text-gray-600 leading-tight">{g.label}</span>
                      {g.field === "date" && <input type="date" value={fills.date} onChange={(e) => setFills((f) => ({ ...f, date: e.target.value }))} className={`${field} w-full`} />}
                      {g.field === "turnout" && <input type="number" value={fills.turnout} onChange={(e) => setFills((f) => ({ ...f, turnout: e.target.value }))} placeholder="# attended" className={`${field} w-full`} />}
                      {g.field === "budget" && <input type="number" value={fills.budget} onChange={(e) => setFills((f) => ({ ...f, budget: e.target.value }))} placeholder="$ total" className={`${field} w-full`} />}
                      {g.field === "outcome" && <input value={fills.outcome} onChange={(e) => setFills((f) => ({ ...f, outcome: e.target.value }))} placeholder="one-line verdict" className={`${field} w-full`} />}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <button onClick={() => { setStage("input"); }} className="text-sm text-gray-500 hover:text-gray-800">← Back</button>
              <div className="flex items-center gap-2">
                {err && <span className="text-sm text-red-600">{err}</span>}
                <button onClick={create} disabled={stage === "saving"} className="px-4 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-black disabled:opacity-50 inline-flex items-center gap-1">
                  {stage === "saving" ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : <><Check className="w-4 h-4" /> Create wrapped event</>}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
