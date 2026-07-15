import { useEffect, useRef, useState, type ReactNode } from "react";
import { Paperclip, Loader2, Check, X, AlertCircle } from "lucide-react";
import {
  extractForBackfill, listTemplates, backfillWrappedEvent, createTemplateFromExtract, applyTemplateAdditions,
  uploadDocument, setEventMaterials, addSourceMaterial, enrichExistingEvent, type SourceMaterial, type EventPlanning,
} from "../lib/db";
import {
  matchTemplates, completenessGaps, templateAdditions, hasAdditions,
  type BackfillExtract, type TemplateLite, type TemplateMatch, type TemplateAdditions,
} from "../lib/backfill";
import { unsupportedFileMessage, isWorkbookFile } from "../lib/fileSupport";
import { useProfile } from "../lib/profile";

// Backfill a past event by dropping its debrief/brief. Extract → classify + match a template
// (propose, don't auto-merge) → completeness prompt (not a block) → create the wrapped record,
// adopt/extend the one template. No-propagation: extending a template never rewrites siblings.
type Choice = string; // template id | "new" | "none"

export function BackfillModal({ onClose, onCreated, initialText, initialFiles, enrich }: { onClose: () => void; onCreated: (eventId: string) => void; initialText?: string; initialFiles?: File[] | null; enrich?: { eventId: string; plan: EventPlanning } }) {
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
  const [tmplQuery, setTmplQuery] = useState(""); // search OTHER templates by name (don't list them all)
  const [excluded, setExcluded] = useState<Set<string>>(new Set()); // addition items the user unchecked
  const [ownerProfileId, setOwnerProfileId] = useState<string | null>(null); // reviewer-confirmed owner
  const { profiles } = useProfile();

  // Edit any extracted field in place before creating. All review inputs write straight to `x`.
  const edit = (patch: Partial<BackfillExtract>) => setX((p) => (p ? { ...p, ...patch } : p));
  const dedup = (arr: string[]) => { const seen = new Set<string>(); return arr.filter((s) => { const k = s.trim().toLowerCase(); return k && !seen.has(k) ? (seen.add(k), true) : false; }); };
  // Enrich: fold the extract into the event's current values so the review is the full merged state.
  const mergeWithPlan = (ex: BackfillExtract, p: EventPlanning): BackfillExtract => ({
    ...ex,
    name: p.title || ex.name,
    date: p.date ?? ex.date,
    location: p.location ?? ex.location,
    owner: ex.owner ?? (p.owners[0]?.name ?? null),
    headcount: p.rsvp ?? p.headcount ?? ex.headcount,
    turnoutActual: p.checkedIn ?? ex.turnoutActual,
    verdict: p.verdict?.trim() ? p.verdict : ex.verdict,
    staffRoles: dedup([...p.staffRoles, ...ex.staffRoles]),
    lessons: dedup([...p.reflections, ...ex.lessons]),
    heuristics: dedup([...p.heuristics, ...ex.heuristics]),
    phases: dedup([...p.phases.map((ph) => ph.name), ...ex.phases]),
    agenda: p.agenda.length ? [...p.agenda, ...ex.agenda.filter((a) => !p.agenda.some((pa) => pa.title.trim().toLowerCase() === a.title.trim().toLowerCase()))] : ex.agenda,
  });
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const matchOwner = (name: string | null): string | null => {
    if (!name?.trim()) return null;
    const w = norm(name);
    const m = profiles.find((p) => p.name.toLowerCase() === name.trim().toLowerCase() || norm((p.email ?? "").split("@")[0]) === w)
      ?? profiles.find((p) => { const n = norm(p.name); return n.length >= 3 && (n === w || n.startsWith(w) || w.startsWith(n)); });
    return m?.id ?? null;
  };
  // True only when the name maps to a profile by an EXACT name/email match (else the reviewer should confirm).
  const ownerExact = !!x?.owner && profiles.some((p) => p.name.toLowerCase() === x!.owner!.trim().toLowerCase() || norm((p.email ?? "").split("@")[0]) === norm(x!.owner!));

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
      const [rawEx, tmpls] = await Promise.all([extractForBackfill(text), listTemplates()]);
      // Enrich mode: merge the extract with the existing event so the review shows the full picture.
      const ex = enrich ? mergeWithPlan(rawEx, enrich.plan) : rawEx;
      const ms = matchTemplates(tmpls, { format: ex.format, tag: ex.tag });
      setX(ex); setTemplates(tmpls); setMatches(ms);
      setOwnerProfileId(enrich?.plan.owners[0]?.id ?? matchOwner(ex.owner)); // keep existing owner; else best-guess
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
      const merged = x; // all review edits already wrote straight to x
      // Enrich mode: apply to the EXISTING event, attach the docs as context, done.
      if (enrich) {
        await enrichExistingEvent(enrich.eventId, merged, ownerProfileId);
        for (const f of attachFiles) {
          try { const url = await uploadDocument(f); await addSourceMaterial(enrich.eventId, { name: f.name, url, type: f.type || "text/plain" }); } catch { /* non-fatal */ }
        }
        onCreated(enrich.eventId);
        return;
      }
      let templateId: string | null = null;
      if (choice === "new") templateId = await createTemplateFromExtract(merged);
      else if (choice !== "none") {
        templateId = choice;
        const sel = selectedAdds();
        if (hasAdditions(sel)) await applyTemplateAdditions(choice, sel);
      }
      const eventId = await backfillWrappedEvent(merged, templateId, ownerProfileId);
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
          <h2 className="text-xl">{enrich ? `Add to “${enrich.plan.title}”` : "Backfill a past event"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-gray-500 mb-4">{enrich ? "Drop a debrief or brief for this event. EventHub extracts everything and merges it in — review and correct below before it's applied." : "Drop its debrief or brief. EventHub creates the wrapped record, fills what it can, and builds on the matching template. Nothing's created until you confirm."}</p>

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
            {/* Editable details — everything extracted, correctable before you create. */}
            <div className="rounded-xl border border-gray-200 p-4 space-y-3">
              <p className="text-[13px] font-medium text-gray-700">Details <span className="text-gray-400 font-normal">· edit anything the extractor missed or got wrong</span></p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5">
                <label className="flex flex-col gap-1 sm:col-span-2"><span className="text-[12px] text-gray-500">Name</span><input value={x.name} onChange={(e) => edit({ name: e.target.value })} className={`${field} w-full`} /></label>
                <label className="flex flex-col gap-1"><span className="text-[12px] text-gray-500">Date</span><input type="date" value={x.date ?? ""} onChange={(e) => edit({ date: e.target.value || null })} className={`${field} w-full`} /></label>
                <label className="flex flex-col gap-1"><span className="text-[12px] text-gray-500">Location</span><input value={x.location ?? ""} onChange={(e) => edit({ location: e.target.value || null })} placeholder="Venue / city" className={`${field} w-full`} /></label>
                <label className="flex flex-col gap-1"><span className="text-[12px] text-gray-500">Invited</span><input type="number" value={x.headcount ?? ""} onChange={(e) => edit({ headcount: e.target.value === "" ? null : Number(e.target.value) })} placeholder="#" className={`${field} w-full`} /></label>
                <label className="flex flex-col gap-1"><span className="text-[12px] text-gray-500">Attended</span><input type="number" value={x.turnoutActual ?? ""} onChange={(e) => edit({ turnoutActual: e.target.value === "" ? null : Number(e.target.value) })} placeholder="#" className={`${field} w-full`} /></label>
              </div>
              {/* Owner — matched to a profile; confirm when the match isn't exact. */}
              <div className="flex flex-col gap-1">
                <span className="text-[12px] text-gray-500">Owner</span>
                <div className="flex items-center gap-2">
                  <input value={x.owner ?? ""} onChange={(e) => { const v = e.target.value || null; edit({ owner: v }); setOwnerProfileId(matchOwner(v)); }} placeholder="Named owner" className={`${field} flex-1`} />
                  <select value={ownerProfileId ?? ""} onChange={(e) => setOwnerProfileId(e.target.value || null)} className={`${field} max-w-[12rem] bg-white`}>
                    <option value="">Unassigned</option>
                    {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                {x.owner && !ownerExact && (
                  <span className="text-[12px] text-amber-700 inline-flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Confirm which profile "{x.owner}" is — pick the right one above.</span>
                )}
              </div>
              <label className="flex flex-col gap-1"><span className="text-[12px] text-gray-500">Outcome / verdict</span><input value={x.verdict} onChange={(e) => edit({ verdict: e.target.value })} placeholder="one-line verdict" className={`${field} w-full`} /></label>
            </div>

            {/* Roles */}
            <ListEditor label="Roles" placeholder="Add a role (e.g. Photographer)" items={x.staffRoles} onChange={(staffRoles) => edit({ staffRoles })} />
            {/* Run of show */}
            <AgendaEditor items={x.agenda} onChange={(agenda) => edit({ agenda })} />
            {/* Lessons */}
            <ListEditor label="Lessons" placeholder="Add a learning" items={x.lessons} onChange={(lessons) => edit({ lessons })} />

            {/* template match — suggest only RELEVANT templates; search for any other. (New records only.) */}
            {!enrich && (() => {
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
            {!enrich && adds && hasAdditions(adds) && (
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

            {/* Still-empty hint — recomputed live as you edit above. */}
            {(() => { const g = completenessGaps(x).gaps; return g.length > 0 ? (
              <p className="text-[12px] text-amber-700 inline-flex items-center gap-1.5"><AlertCircle className="w-4 h-4 shrink-0" /> Still empty: {g.map((gg) => gg.label).join(", ")} — fill above, or add later.</p>
            ) : null; })()}

            <div className="flex items-center justify-between gap-2">
              <button onClick={() => { setStage("input"); }} className="text-sm text-gray-500 hover:text-gray-800">← Back</button>
              <div className="flex items-center gap-2">
                {err && <span className="text-sm text-red-600">{err}</span>}
                <button onClick={create} disabled={stage === "saving"} className="px-4 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-black disabled:opacity-50 inline-flex items-center gap-1">
                  {stage === "saving" ? <><Loader2 className="w-4 h-4 animate-spin" /> {enrich ? "Applying…" : "Creating…"}</> : <><Check className="w-4 h-4" /> {enrich ? "Apply to event" : "Create wrapped event"}</>}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const rowInput = "px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300";

// Editable string list (roles, lessons) — inline-edit each, remove, and add.
function ListEditor({ label, placeholder, items, onChange }: { label: string; placeholder: string; items: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => { const t = draft.trim(); if (!t) return; onChange([...items, t]); setDraft(""); };
  return (
    <div>
      <p className="text-[13px] font-medium text-gray-700 mb-1">{label} <span className="text-gray-400 font-normal">· {items.length}</span></p>
      {items.length > 0 && (
        <ul className="space-y-1 mb-2">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-2">
              <input value={it} onChange={(e) => onChange(items.map((v, j) => (j === i ? e.target.value : v)))} className={`${rowInput} flex-1`} />
              <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-600" aria-label="Remove"><X className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder={placeholder} className={`${rowInput} flex-1`} />
        <button onClick={add} disabled={!draft.trim()} className="text-[13px] text-gray-500 hover:text-gray-900 disabled:opacity-40">Add</button>
      </div>
    </div>
  );
}

// Editable run-of-show (time + item rows).
function AgendaEditor({ items, onChange }: { items: { time: string; title: string }[]; onChange: (v: { time: string; title: string }[]) => void }) {
  const [time, setTime] = useState("");
  const [title, setTitle] = useState("");
  const add = () => { const t = title.trim(); if (!t) return; onChange([...items, { time: time.trim(), title: t }]); setTime(""); setTitle(""); };
  return (
    <div>
      <p className="text-[13px] font-medium text-gray-700 mb-1">Run of show <span className="text-gray-400 font-normal">· {items.length}</span></p>
      {items.length > 0 && (
        <ul className="space-y-1 mb-2">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-2">
              <input value={it.time} onChange={(e) => onChange(items.map((v, j) => (j === i ? { ...v, time: e.target.value } : v)))} placeholder="time" className={`${rowInput} w-24`} />
              <input value={it.title} onChange={(e) => onChange(items.map((v, j) => (j === i ? { ...v, title: e.target.value } : v)))} className={`${rowInput} flex-1`} />
              <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-600" aria-label="Remove"><X className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <input value={time} onChange={(e) => setTime(e.target.value)} placeholder="6:30 PM" className={`${rowInput} w-24`} />
        <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Add a run-of-show item" className={`${rowInput} flex-1`} />
        <button onClick={add} disabled={!title.trim()} className="text-[13px] text-gray-500 hover:text-gray-900 disabled:opacity-40">Add</button>
      </div>
    </div>
  );
}
