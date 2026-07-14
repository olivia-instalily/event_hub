// Re-run AI extraction on an event/template's attached source materials and ADD anything missing
// (non-destructive — never removes or overwrites existing content). Events fill phases +
// deliverables; templates additionally fill the walkthrough, principles (heuristics), outreach, and
// staff roles — the pattern fields that make a template useful. Shared by the event page and the
// template page. Reads text, PDFs (pdf.js), and spreadsheets (SheetJS); other binaries are skipped.
import { extractBrief, setEventPattern, addDeliverable, setEventStaffRoles, type EventPlanning } from "./db";

// `plan` is what gets WRITTEN (phases/deliverables/pattern). `opts.source` is where the source
// MATERIALS are read from — defaults to `plan`, but for a template paired to a settled event the
// materials live on the event, so pass the event as `source` and the template as `plan`.
export async function regenerateFromMaterials(plan: EventPlanning, opts: { template: boolean; source?: EventPlanning }): Promise<string> {
  const source = opts.source ?? plan;
  // 1) Gather text from every readable material.
  const texts: string[] = [];
  let skipped = 0;
  for (const m of source.sourceMaterials) {
    const n = m.name.toLowerCase();
    const t = (m.type || "").toLowerCase();
    const isWorkbook = /\.(xlsx|xls|xlsm|ods)$/.test(n);
    const isPdf = /\.pdf$/.test(n) || t.includes("pdf");
    const isTextual = t.startsWith("text") || /\.(md|markdown|txt|csv|tsv|json|log|ya?ml)$/.test(n);
    if (!isWorkbook && !isPdf && !isTextual) { skipped++; continue; }
    try {
      const blob = await fetch(m.url).then((r) => r.blob());
      const file = new File([blob], m.name, { type: m.type || blob.type });
      let text = "";
      if (isWorkbook) text = await (await import("./workbook")).readWorkbookAsText(file);
      else if (isPdf) text = await (await import("./pdfText")).readPdfText(file);
      else text = await file.text();
      if (text.trim()) texts.push(`# ${m.name}\n${text}`); else skipped++;
    } catch { skipped++; }
  }
  if (!texts.length) return skipped ? `Couldn't read any of the ${skipped} attached file${skipped === 1 ? "" : "s"}.` : "No materials to regenerate from.";

  const ex = await extractBrief(texts.join("\n\n"), { templateMode: opts.template });

  // 2) Phases — append new names (by case-insensitive name), pulling from phases/deliverables/steps.
  const existingPhases = new Set(plan.phases.map((p) => p.name.toLowerCase()));
  const exPhaseNames = [...ex.phases];
  for (const d of ex.deliverables) if (d.phase && !exPhaseNames.includes(d.phase)) exPhaseNames.push(d.phase);
  for (const s of ex.walkthrough) if (s.phase && !exPhaseNames.includes(s.phase)) exPhaseNames.push(s.phase);
  const newPhaseNames = exPhaseNames.filter((nm) => nm && !existingPhases.has(nm.toLowerCase()));
  let maxOrder = plan.phases.reduce((mx, p) => Math.max(mx, p.order), -1);
  const mergedPhases = [...plan.phases.map((p) => ({ name: p.name, order: p.order })), ...newPhaseNames.map((nm) => ({ name: nm, order: ++maxOrder }))];

  // 3) Template-only pattern fields.
  let addedWalk = 0, addedHeur = 0, addedOut = 0, addedRoles = 0;
  if (opts.template) {
    const wSeen = new Set(plan.walkthrough.map((s) => s.title.trim().toLowerCase()));
    const newWalk = ex.walkthrough.filter((s) => s.title?.trim() && !wSeen.has(s.title.trim().toLowerCase()));
    const hSeen = new Set(plan.heuristics.map((h) => h.trim().toLowerCase()));
    const newHeur = ex.heuristics.filter((h) => h.trim() && !hSeen.has(h.trim().toLowerCase()));
    const oSeen = new Set(plan.outreach.map((o) => o.title.trim().toLowerCase()));
    const newOut = ex.outreach.filter((o) => o.title?.trim() && !oSeen.has(o.title.trim().toLowerCase()));
    addedWalk = newWalk.length; addedHeur = newHeur.length; addedOut = newOut.length;
    if (newPhaseNames.length || newWalk.length || newHeur.length || newOut.length) {
      await setEventPattern(plan.id, {
        phases: mergedPhases,
        walkthrough: [...plan.walkthrough, ...newWalk],
        heuristics: [...plan.heuristics, ...newHeur],
        outreach: [...plan.outreach, ...newOut],
      });
    }
    const rSeen = new Set(plan.staffRoles.map((r) => r.toLowerCase()));
    const newRoles = ex.staff.filter((r) => r.trim() && !rSeen.has(r.trim().toLowerCase()));
    if (newRoles.length) { await setEventStaffRoles(plan.id, [...plan.staffRoles, ...newRoles]); addedRoles = newRoles.length; }
  } else if (newPhaseNames.length) {
    await setEventPattern(plan.id, { phases: mergedPhases });
  }

  // 4) Deliverables — add any not already present (by phase|title).
  const seen = new Set(plan.deliverables.map((d) => `${(d.phase ?? "").toLowerCase()}|${d.title.trim().toLowerCase()}`));
  const firstPhase = ex.phases[0] ?? plan.phases[0]?.name ?? "Planning";
  let addedDeliverables = 0;
  for (const d of ex.deliverables) {
    const title = d.title?.trim();
    if (!title) continue;
    const phase = d.phase || firstPhase;
    const key = `${phase.toLowerCase()}|${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try { await addDeliverable(plan.id, { title, phase, ownerRole: null, dueDate: null, offsetStart: d.offsetStart ?? null, offsetEnd: d.offsetEnd ?? null }); addedDeliverables++; } catch { /* non-fatal */ }
  }

  // 5) Message.
  const parts: string[] = [];
  if (newPhaseNames.length) parts.push(`${newPhaseNames.length} phase${newPhaseNames.length === 1 ? "" : "s"}`);
  if (addedDeliverables) parts.push(`${addedDeliverables} deliverable${addedDeliverables === 1 ? "" : "s"}`);
  if (addedWalk) parts.push(`${addedWalk} walkthrough step${addedWalk === 1 ? "" : "s"}`);
  if (addedHeur) parts.push(`${addedHeur} principle${addedHeur === 1 ? "" : "s"}`);
  if (addedOut) parts.push(`${addedOut} outreach template${addedOut === 1 ? "" : "s"}`);
  if (addedRoles) parts.push(`${addedRoles} role${addedRoles === 1 ? "" : "s"}`);
  const skippedNote = skipped ? ` (${skipped} file${skipped === 1 ? "" : "s"} couldn't be read.)` : "";
  return parts.length ? `Added ${parts.join(" · ")}.${skippedNote}` : `Up to date — nothing new to add.${skippedNote}`;
}
