import { supabase, proxiedBackend } from './supabase';
import { sharedFiles, type DupEvent } from './dedup';
import { scopingToApproval, loadScoping } from './scoping';
import { PAGE_PUBLIC_FIELDS } from './page';
import { dueOffsetForTitle } from './schedule';
import { matchFormat } from './formats';
import { labelsMatch } from './capturePromote';
import { categoryKey } from './budgetCategories';
import { eventFocus, type EventFocus } from './eventFocus';
import type { BackfillExtract, TemplateLite, TemplateAdditions } from './backfill';
import { generalizeStaffRole } from './backfill';
import { vendorStage, type VendorRow as VendorListRow } from './vendorImport';
import { defaultPhases } from './eventPhases';
import { type Campaign, type Drive, type CrewRole, emptyCampaign, normalizeCampaign, coerceRole } from "./campaign";
import { isInternalEmail } from "./people";

// A template must be name-free: reduce staff roles to their general form and drop bare names / dups.
const generalRoles = (roles: string[]): string[] => {
  const out: string[] = []; const seen = new Set<string>();
  for (const raw of roles) { const r = generalizeStaffRole(raw); if (!r) continue; const k = r.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(r); } }
  return out;
};
import { mergePhaseList } from './phaseMerge';

// The prototype's status tabs are future / in-process / past. Series carry richer
// macro stages ("Wrapped", "Live", ...). Map them onto the three the UI has.
export type EventStatus = 'future' | 'in-process' | 'past';

export function statusFromSeries(seriesStatus: string | null | undefined): EventStatus {
  switch ((seriesStatus ?? '').toLowerCase()) {
    case 'wrapped':
    case 'past':
      return 'past';
    case 'live':
    case 'planning':
    case 'week-of':
    case 'concept':
      return 'in-process';
    default:
      return 'future';
  }
}

export interface EventListItem {
  id: string;
  title: string;
  seriesId: string | null;
  seriesName: string | null;
  tags: string[]; // editable per-event tags (presets + custom)
  format: string | null; // → eventType chip
  location: string | null;
  date: string | null; // event_date; null = not captured
  startTime: string | null; // local "HH:MM"
  endTime: string | null;   // local "HH:MM"
  status: EventStatus;
  owner: string | null; // joined owner names (for the list column/filter)
  owners: { id: string; name: string; color: string | null }[];
  attendeeCount: number | null; // checked_in — the concrete attendance number
  rsvp: number | null;
  capacity: number | null;
  lumaEventId: string | null;
  lumaUrl: string | null;
  lumaName: string | null;
  gcalEventId: string | null;   // set ⇒ synced to Google Calendar
  gcalHtmlLink: string | null;  // deep link to the Google Calendar event
  slackChannel: string | null;  // linked Slack channel id ⇒ :eventhub: pins route here
  coverImageUrl: string | null; // active/displayed cover
  lumaCoverUrl: string | null;
  customCoverUrl: string | null;
  coverPosition: string | null;
  labelIds: string[];
  macroStage: string | null; // set ⇒ an event we're actively planning (routes to the planning view)
  isTemplate: boolean; // a reusable Event Type (open slots), not a concrete instance
  // External conference: a lightweight "we're attending this" instance — NOT an operated event
  // (no workspace/budget/deliverables). Shows on the calendar, marked External.
  isExternal: boolean;
  endDate: string | null;  // external range end; null = single-day
  quarter: string | null;  // manual planning tag (Q1–Q4)
  why: string | null;      // why it's relevant (free text)
  infoUrl: string | null;  // link to the conference
  finalRecordComplete: boolean; // post-event reflections deliverable is Done → a complete record
  settled: boolean; // settle_state === 'settled' → fully wrapped/settled (shows a green marker, sits in Past)
}

export interface Speaker {
  id: string;
  name: string | null;
  title: string | null;
  org: string | null;
}

export interface AttendeeView {
  id: string;
  name: string | null;
  type: string | null;
  org: string | null;
  title: string | null;
  role: string;
  isAggregate: boolean;
  countEst: string | null;
  note: string | null;
}

export interface EngagementView {
  id: string;
  category: string | null;
  vendorName: string | null;
  stage: string | null;
  confirmedAmount: number | null;
  note: string | null;
}

export interface BudgetLineView {
  id: string;
  label: string | null;
  confirmedAmount: number | null;
  linkedEngagement: string | null;
  isUncategorized: boolean;
  note: string | null;
}

export interface BudgetView {
  id: string;
  currency: string;
  reportedTotal: number | null;
  lineSum: number;
  discrepancy: number; // reportedTotal - lineSum; spec requires flagging, not hiding
  lines: BudgetLineView[];
}

export interface EventDetail extends EventListItem {
  description: string | null;
  audience: string | null;
  actualAttendanceNote: string | null;
  checkedIn: number | null;
  waitlistAdmitted: number | null;
  notes: string[];
  sourceMaterials: SourceMaterial[];
  speakers: Speaker[];
  attendees: AttendeeView[];
  reflections: Reflection[];
  engagements: EngagementView[];
  budget: BudgetView | null;
  seriesStatus: string | null;
  seriesVerdict: string | null;
}

type SeriesJoin = {
  id: string;
  name: string | null;
  type: string | null;
  status: string | null;
  owning_team: string | null;
  verdict?: string | null;
} | null;

// Standalone events (no series) get their status from their date.
function statusFromDate(date: string | null | undefined): EventStatus {
  if (!date) return 'future';
  const today = new Date().toISOString().slice(0, 10);
  return date < today ? 'past' : 'future';
}

// An event being planned (macro_stage set) is in-process by nature — with two ends:
//  • 'Concept' is the pre-work stage (e.g. just drawn from Luma, essentials not yet confirmed) → future.
//  • 'Wrap'/'Wrapped' is the post-event wind-down → past.
// Everything in between (Planning / Week-of / Live) is active → in-process.
function statusFromMacroStage(stage: string): EventStatus {
  const k = stage.toLowerCase();
  if (k === 'concept') return 'future';
  if (k === 'wrap' || k === 'wrapped') return 'past';
  return 'in-process';
}

// Resolve an event's coarse status: a fully-settled event is past (terminal), then a manual
// override, then macro_stage, then the series status, then the date.
function resolveStatus(row: any, series: SeriesJoin): EventStatus {
  if (row.settle_state === 'settled') return 'past';
  const o = row.status;
  if (o === 'future' || o === 'in-process' || o === 'past') return o;
  if (row.macro_stage) return statusFromMacroStage(row.macro_stage);
  if (series?.status) return statusFromSeries(series.status);
  return statusFromDate(row.event_date);
}

// Map the event_owner embed → owners array + a joined name string.
function ownersOf(row: any): { owner: string | null; owners: { id: string; name: string; color: string | null }[] } {
  const owners = (row.owners ?? [])
    .map((o: any) => o.profile)
    .filter(Boolean)
    .map((p: any) => ({ id: p.id, name: p.name, color: p.color ?? null }));
  return { owner: owners.length ? owners.map((o: any) => o.name).join(', ') : null, owners };
}

function toListItem(row: any): EventListItem {
  const series: SeriesJoin = row.series ?? null;
  return {
    id: row.id,
    title: row.name,
    seriesId: series?.id ?? row.series_id ?? null,
    seriesName: series?.name ?? null,
    tags: row.tags ?? (row.tag ? [row.tag] : []),
    format: row.format ?? null,
    location: row.location ?? row.office ?? null,
    date: row.event_date ?? null,
    startTime: row.start_time ?? null,
    endTime: row.end_time ?? null,
    status: resolveStatus(row, series),
    ...ownersOf(row),
    attendeeCount: row.checked_in ?? null,
    rsvp: row.rsvp ?? null,
    capacity: row.capacity ?? null,
    lumaEventId: row.luma_event_id ?? null,
    lumaUrl: row.luma_url ?? null,
    lumaName: row.luma_name ?? null,
    gcalEventId: row.gcal_event_id ?? null,
    gcalHtmlLink: row.gcal_html_link ?? null,
    slackChannel: row.slack_channel ?? null,
    coverImageUrl: row.cover_image_url ?? null,
    lumaCoverUrl: row.luma_cover_url ?? null,
    customCoverUrl: row.custom_cover_url ?? null,
    coverPosition: row.cover_position ?? null,
    labelIds: (row.event_label ?? []).map((l: any) => l.label_id),
    macroStage: row.macro_stage ?? null,
    isTemplate: row.is_template ?? false,
    isExternal: row.is_external ?? false,
    endDate: row.end_date ?? null,
    quarter: row.quarter ?? null,
    why: row.why ?? null,
    infoUrl: row.info_url ?? null,
    finalRecordComplete: false, // set by listEvents from the reflection-deliverable status
    settled: row.settle_state === 'settled',
  };
}

/** Update an event's tags. Direct client write — no secret, low-stakes field. */
export async function updateEventTags(eventId: string, tags: string[]): Promise<void> {
  const { error } = await supabase.from('event').update({ tags }).eq('id', eventId);
  if (error) throw error;
}

/** Set the event's owner (owning team). */
export async function updateEventOwner(eventId: string, owner: string | null): Promise<void> {
  const { error } = await supabase.from('event').update({ owning_team: owner }).eq('id', eventId);
  if (error) throw error;
}

/** Set the manual status override (future | in-process | past). */
export async function updateEventStatus(eventId: string, status: EventStatus): Promise<void> {
  const { error } = await supabase.from('event').update({ status }).eq('id', eventId);
  if (error) throw error;
  // Marking an event in-process is an explicit "I'm working on this" — graduate it out of 'Concept'
  // so the planning view stops opening on the setup steps and its stage matches its status.
  if (status === 'in-process') await graduateFromConcept(eventId);
}

/** A freshly-drawn event (Luma import → 'Concept', i.e. status "future") sits untouched until
 *  someone actually works on it: adds planning content, fills an essentials field on the site, or
 *  explicitly marks it in-process. Any of those graduates it to 'Planning' (→ "in-process").
 *  Scoped to macro_stage='Concept' so it never drags an event that's already further along
 *  (Week-of/Live/Wrap) backward, and is a no-op for events that were never Concept. Best-effort:
 *  a graduation failure must never break the primary action that triggered it. The Luma sync writes
 *  raw (bypassing these app-layer setters), so a Luma-populated date/location/name never trips this
 *  — only on-site edits do. */
async function graduateFromConcept(eventId: string): Promise<void> {
  try {
    await supabase.from('event').update({ macro_stage: 'Planning' }).eq('id', eventId).eq('macro_stage', 'Concept');
  } catch { /* best-effort — the event still resolves its status correctly from other signals */ }
}

/** Permanently delete an event. FKs cascade (engagements, budget+lines, deliverables,
 *  attendee links, owners, labels, …); shared attendees stay. No undo. */
export async function deleteEvent(eventId: string): Promise<void> {
  // Unsync from Google Calendar BEFORE deleting the row — the function reads gcal_event_ids off
  // the row; if the row is gone first it 404s and orphans calendar copies.
  await deleteEventFromGoogleCalendar(eventId).catch((e) => console.warn('gcal unsync failed', e));
  const { error } = await supabase.from('event').delete().eq('id', eventId);
  if (error) throw error;
}

// ── Create events ────────────────────────────────────────────────────────────
const newId = (prefix: string) => `${prefix}-` + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));

/** Persist a planned event + its generated template, return the new event id.
 *  vendor categories → engagements (Sourced), budget lines → estimate lines,
 *  progress workstreams → Planning deliverables. macro_stage 'Planning' routes it
 *  to the planning view. */
export async function createPlanningEvent(input: {
  name: string; date: string | null; location: string | null; tags: string[]; template: GeneratedTemplate;
  format?: string | null; startTime?: string | null; endTime?: string | null;
  phases?: { name: string; order: number }[]; planningLeadTime?: string | null;
  hosting?: 'solo' | 'cohost'; coHost?: string | null; modeledOnEventId?: string | null;
  isTemplate?: boolean;
  agenda?: { time: string; title: string }[]; staffRoles?: string[]; reflections?: string[];
  walkthrough?: WalkStep[]; heuristics?: string[]; outreach?: OutreachTemplate[];
  // Deliverables carrying their assigned phase (preferred over template.progressCategories, which
  // is title-only and would all default to "Planning"). Phase blank → falls back to first phase.
  deliverables?: { title: string; phase?: string | null }[];
}): Promise<string> {
  const eventId = newId('evt');
  // Snap the format to the closest existing one before storing (no near-duplicate formats).
  const format = await canonicalizeFormat(input.format ?? null);
  const eventRow = {
    id: eventId, name: input.name, event_date: input.date, location: input.location, format,
    start_time: input.startTime ?? null, end_time: input.endTime ?? null,
    phases: input.phases ?? [], planning_lead_time: input.planningLeadTime ?? null,
    agenda: input.agenda ?? [], staff_roles: input.staffRoles ?? [], reflections: input.reflections ?? [],
    walkthrough: input.walkthrough ?? [], heuristics: input.heuristics ?? [], outreach: input.outreach ?? [],
    is_template: input.isTemplate ?? false,
    tags: input.tags, macro_stage: 'Planning', modeled_on_event_id: input.modeledOnEventId ?? null,
    hosting: input.hosting ?? 'solo', co_host: input.hosting === 'cohost' ? (input.coHost?.trim() || null) : null,
  };

  const engagements = input.template.vendorCategories.map((cat) => ({ id: newId('eng'), event_id: eventId, category: cat, stage: 'Sourced' }));

  const budgetId = newId('bud');
  const budgetRow = { id: budgetId, event_id: eventId, currency: 'USD' };
  const budgetLines = input.template.budgetLines.map((l) => ({ id: newId('bl'), budget_id: budgetId, label: l.label, confirmed_amount: l.estimate }));

  // Seed each workstream's due offset from the standard schedule (compressed if the
  // planning window is short). When the date is known at creation, resolve concrete due
  // dates right away (date + offset); otherwise the setup walkthrough resolves them once
  // the date is set.
  const startDate = new Date().toISOString().slice(0, 10);
  const base = input.date ? new Date(input.date + 'T00:00:00') : null;
  type DelRow = { id: string; event_id: string; title: string; phase: string; status: string; due_offset_days: number | null; offset_start: number | null; resolved_due_date: string | null; locked: boolean };
  // Prefer phased deliverables (each keeps its assigned phase); else fall back to the title-only
  // progressCategories (which have no phase → the first phase, or "Planning").
  const firstPhase = (input.phases ?? []).slice().sort((a, b) => a.order - b.order)[0]?.name ?? 'Planning';
  const delItems: { title: string; phase?: string | null }[] = input.deliverables?.length
    ? input.deliverables
    : input.template.progressCategories.map((p) => ({ title: p, phase: null }));
  const deliverables: DelRow[] = delItems.filter((it) => it.title?.trim()).map(({ title, phase }) => {
    const offset = dueOffsetForTitle(title, input.date, startDate);
    let resolved: string | null = null;
    if (base) { const due = new Date(base); due.setDate(due.getDate() + offset); resolved = due.toISOString().slice(0, 10); }
    return { id: newId('del'), event_id: eventId, title, phase: (phase && phase.trim()) || firstPhase, status: 'Todo', due_offset_days: offset, offset_start: null, resolved_due_date: resolved, locked: false };
  });

  // Every event/template carries a non-deletable post-event post-mortem deliverable.
  // Placed in the last phase (else "Wrap"), a couple days after the event (offset +2).
  const lastPhase = (input.phases ?? []).slice().sort((a, b) => a.order - b.order).pop()?.name ?? 'Wrap';
  const pmOffset = 2;
  const pmDue = base ? (() => { const d = new Date(base); d.setDate(d.getDate() + pmOffset); return d.toISOString().slice(0, 10); })() : null;
  deliverables.push({ id: newId('del'), event_id: eventId, title: 'Post-event reflections & insights', phase: lastPhase, status: 'Todo', due_offset_days: null, offset_start: pmOffset, resolved_due_date: pmDue, locked: true });

  // All inserts run inside one plpgsql transaction — any failure rolls back everything.
  const { data, error } = await supabase.rpc('create_planning_event', {
    p_event: eventRow, p_engagements: engagements, p_budget: budgetRow, p_budget_lines: budgetLines, p_deliverables: deliverables,
  });
  if (error) throw error;
  const createdId = (data as string) ?? eventId;
  // Auto-sync to Google Calendar when the event has a date and is not a template.
  if (input.date && !input.isTemplate) autoSyncGcal(createdId);
  return createdId;
}

/** Persist a backfilled past event (no template). Returns the new event id. */
export async function backfillEvent(input: { name: string; date: string | null; location: string | null; description: string | null }): Promise<string> {
  const id = newId('evt');
  const { error } = await supabase.from('event').insert({
    id, name: input.name, event_date: input.date, location: input.location, description: input.description,
    phases: defaultPhases(input.date),
  });
  if (error) throw error;
  if (input.date) autoSyncGcal(id);
  return id;
}

export interface VendorSuggestion {
  id: string;
  name: string;
  category: string | null;
  location: string | null;
  link: string | null;
  note: string | null;
}

/** Suggest vendors from our vendor database, ranked toward the event's location/category.
 *  The `vendor` table isn't populated yet, so this returns [] gracefully until it is. */
export async function suggestVendors(category: string | null, location: string | null): Promise<VendorSuggestion[]> {
  try {
    let q = supabase.from('vendor').select('id, name, category, location, link, note');
    if (category) q = q.ilike('category', `%${category}%`);
    if (location) q = q.ilike('location', `%${location}%`);
    const { data, error } = await q.limit(10);
    if (error) return []; // table not set up yet
    return (data ?? []).map((r: any) => ({
      id: r.id, name: r.name, category: r.category ?? null, location: r.location ?? null, link: r.link ?? null, note: r.note ?? null,
    }));
  } catch { return []; }
}

// Deployed mode (GCS): base64 the file and POST it to the storage-upload cloud function. Local dev
// keeps talking to Supabase Storage directly (see each caller's `proxiedBackend` branch).
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
async function gcsUpload(file: File, visibility: 'public' | 'private'): Promise<{ url?: string; path?: string }> {
  const res = await fetch('/functions/v1/storage-upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: file.name, contentType: file.type || null, visibility, dataBase64: await fileToBase64(file) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error ?? `Upload failed (${res.status}).`);
  return data as { url?: string; path?: string };
}

/** Upload a dropped file to the attachments bucket; returns its public URL. */
export async function uploadAttachment(file: File): Promise<string> {
  if (proxiedBackend) {
    const { url } = await gcsUpload(file, 'public');
    if (!url) throw new Error('Upload did not return a URL.');
    return url;
  }
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot) : '';
  const path = `${newId('att')}${ext}`;
  const { error } = await supabase.storage.from('attachments').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return supabase.storage.from('attachments').getPublicUrl(path).data.publicUrl;
}

// ── Private document storage (sensitive dropped docs) ────────────────────────
// Sensitive files (briefs/budgets/debriefs) go to the PRIVATE `documents` bucket. Upload
// returns the object PATH (not a URL); callers store the path and it's turned into a
// short-lived SIGNED URL only at read time (see signDocValues) — so the raw object is never
// reachable by public URL. Cover images / avatars stay in the public `attachments` bucket.
const DOC_BUCKET = 'documents';
const SIGNED_TTL = 3600; // seconds

export async function uploadDocument(file: File): Promise<string> {
  if (proxiedBackend) {
    const { path } = await gcsUpload(file, 'private');
    if (!path) throw new Error('Upload did not return a path.');
    return path; // GCS object key; signed on read
  }
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot) : '';
  const path = `${newId('doc')}${ext}`;
  const { error } = await supabase.storage.from(DOC_BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return path; // stored as-is; signed on read
}

// A stored value is a private-doc PATH when it has no scheme (bare key). Full URLs — legacy
// public `attachments` links or external URLs (Luma covers, etc.) — pass through unchanged.
const isDocPath = (v: string | null | undefined): v is string => !!v && !/^[a-z]+:\/\//i.test(v) && !v.startsWith('data:');

/** Batch-sign a set of stored values: doc paths → short-lived signed URLs; everything else
 *  maps to itself. Returns original → resolved. */
export async function signDocValues(values: (string | null | undefined)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const paths = Array.from(new Set(values.filter(isDocPath)));
  if (!paths.length) return out;
  if (proxiedBackend) {
    try {
      const res = await fetch('/functions/v1/storage-sign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths }) });
      const data = await res.json().catch(() => ({}));
      for (const r of ((data as any)?.urls ?? []) as { path: string; url: string }[]) if (r.path && r.url) out.set(r.path, r.url);
    } catch { /* leave unsigned — callers fall back to the raw value */ }
    return out;
  }
  const { data } = await supabase.storage.from(DOC_BUCKET).createSignedUrls(paths, SIGNED_TTL);
  for (const r of data ?? []) if (r.path && r.signedUrl) out.set(r.path, r.signedUrl);
  return out;
}

/** Primary duplicate detector for a drop: find an existing event that already has ANY of the dropped
 *  files (matched by source-material filename). One query, matched client-side. Lets the create flow
 *  short-circuit a re-drop straight to the existing event BEFORE any (slow) extraction runs. */
export async function findDuplicateBySourceFiles(droppedNames: string[]): Promise<{ event: DupEvent; matched: string[] } | null> {
  const dropped = droppedNames.filter(Boolean);
  if (!dropped.length) return null;
  const { data } = await supabase.from('event').select('id, name, event_date, tags, is_template, source_materials');
  for (const row of (data ?? []) as any[]) {
    const mats = Array.isArray(row.source_materials) ? row.source_materials : [];
    const matched = sharedFiles(dropped, mats.map((m: any) => m?.name).filter(Boolean));
    if (matched.length) return { event: { id: row.id, title: row.name, date: row.event_date ?? null, tags: row.tags ?? [], isTemplate: !!row.is_template }, matched };
  }
  return null;
}

// ── Event page ownership / dev round-trip (EventHub side) ────────────────────

/** The frozen World-only snapshot for a page (eject seed + regenerate-diff base).
 *  Selects ONLY the public allowlist, so sensitive data can never be seeded. */
export async function pagePublicSnapshot(eventId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from('event').select(PAGE_PUBLIC_FIELDS.join(', ')).eq('id', eventId).maybeSingle();
  if (error) throw error;
  return (data ?? {}) as Record<string, unknown>;
}

/** Eject: flip a page to dev-owned and freeze a World-only snapshot. */
export async function ejectPage(eventId: string): Promise<PageState> {
  const snapshot = await pagePublicSnapshot(eventId);
  const patch = {
    page_ownership: 'dev-owned',
    repo_ref: `events/${eventId}`,
    ejected_at: new Date().toISOString(),
    ejected_snapshot: snapshot,
    last_deploy_status: 'none',
  };
  const { error } = await supabase.from('event').update(patch).eq('id', eventId);
  if (error) throw error;
  return { ownership: 'dev-owned', repoRef: patch.repo_ref, lastDeployStatus: 'none', previewUrl: null, liveUrl: null, ejectedAt: patch.ejected_at, ejectedSnapshot: snapshot };
}

/** Current public snapshot, for diffing against the frozen ejected_snapshot. Never writes. */
export async function regeneratePageDraft(eventId: string): Promise<Record<string, unknown>> {
  return pagePublicSnapshot(eventId);
}

export async function setPageFields(eventId: string, fields: { repoRef?: string | null; lastDeployStatus?: string | null; previewUrl?: string | null; liveUrl?: string | null }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if ('repoRef' in fields) patch.repo_ref = fields.repoRef;
  if ('lastDeployStatus' in fields) patch.last_deploy_status = fields.lastDeployStatus;
  if ('previewUrl' in fields) patch.preview_url = fields.previewUrl;
  if ('liveUrl' in fields) patch.live_url = fields.liveUrl;
  const { error } = await supabase.from('event').update(patch).eq('id', eventId);
  if (error) throw error;
}

/** Promote preview → live (the Admin sign-off action; stub for the CI promote). */
export async function promoteToLive(eventId: string, previewUrl: string | null): Promise<void> {
  const { error } = await supabase.from('event').update({ live_url: previewUrl, last_deploy_status: 'live' }).eq('id', eventId);
  if (error) throw error;
}

// No-code page builder.
export async function savePageDraft(eventId: string, draft: PageDraft): Promise<void> {
  const { error } = await supabase.from('event').update({ page_draft: draft }).eq('id', eventId);
  if (error) throw error;
}
/** Claude-drafted copy (headline/subhead/about) from the event's public fields. */
export async function generatePageDraft(eventId: string): Promise<{ headline: string; subhead: string; aboutBody: string }> {
  const { data, error } = await supabase.functions.invoke('generate-page', { body: { eventId } });
  if (error || (data as any)?.error) throw new Error((data as any)?.error ?? error?.message ?? 'generation failed');
  return data as { headline: string; subhead: string; aboutBody: string };
}

export interface PageStyleTokens {
  headingFont: PageFont; bodyFont: PageFont; accent: string;
  accentOn: 'marker' | 'title'; headingStyle: 'plain' | 'marker';
  bgColor: string | null; textColor: string | null; agendaLayout: AgendaLayout;
}
/** Infer page style tokens from reference image(s) (Claude vision); merged into the draft theme. */
export async function generatePageStyle(images: { media_type: string; data: string }[]): Promise<PageStyleTokens> {
  const { data, error } = await supabase.functions.invoke('generate-page-style', { body: { images } });
  if (error || (data as any)?.error) throw new Error((data as any)?.error ?? error?.message ?? 'style inference failed');
  return data as PageStyleTokens;
}

// Per-event Developer permission.
export async function listDevelopers(eventId: string): Promise<Developer[]> {
  const { data, error } = await supabase.from('event_developer').select('id, email, created_at').eq('event_id', eventId).order('created_at');
  if (error) throw error;
  return (data ?? []).map((d: any) => ({ id: d.id, email: d.email, createdAt: d.created_at }));
}
export async function addDeveloper(eventId: string, email: string): Promise<Developer> {
  const id = newId('dev');
  const { error } = await supabase.from('event_developer').insert({ id, event_id: eventId, email });
  if (error) throw error;
  return { id, email, createdAt: new Date().toISOString() };
}
export async function removeDeveloper(id: string): Promise<void> {
  const { error } = await supabase.from('event_developer').delete().eq('id', id);
  if (error) throw error;
}

// ── Profiles (pre-auth "current user") ───────────────────────────────────────
export interface Profile { id: string; name: string; email: string | null; color: string | null; createdAt: string; isAdmin: boolean; }
export async function listProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase.from('profile').select('id, name, email, color, created_at, is_admin').order('created_at');
  if (error) throw error;
  return (data ?? []).map((p: any) => ({ id: p.id, name: p.name, email: p.email ?? null, color: p.color ?? null, createdAt: p.created_at, isAdmin: p.is_admin ?? false }));
}
export async function createProfile(name: string, email: string | null, color: string, department: CrewRole = 'none'): Promise<Profile> {
  const id = newId('prof');
  const { error } = await supabase.from('profile').insert({ id, name, email, color });
  if (error) throw error;
  // Same human on the internal person list — link by email + set their department (create if new).
  try { await ensureInternalPerson(name, email, department, { align: true }); } catch { /* non-fatal */ }
  return { id, name, email, color, createdAt: new Date().toISOString(), isAdmin: false };
}
export async function updateProfile(id: string, fields: { name?: string; email?: string | null }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if ('name' in fields) patch.name = fields.name;
  if ('email' in fields) patch.email = fields.email;
  const { error } = await supabase.from('profile').update(patch).eq('id', id);
  if (error) throw error;
}
export async function setProfileAdmin(id: string, isAdmin: boolean): Promise<void> {
  const { error } = await supabase.from('profile').update({ is_admin: isAdmin }).eq('id', id);
  if (error) throw error;
}
export async function deleteProfile(id: string): Promise<void> {
  const { error } = await supabase.from('profile').delete().eq('id', id);
  if (error) throw error;
}

// ── Vendors (the persistent record) ─────────────────────────────────────────
export interface VendorRow {
  id: string;
  name: string | null;
  category: string | null;
  preferredList: string | null;
  notes: string | null;
}
export async function listVendors(): Promise<VendorRow[]> {
  const { data, error } = await supabase
    .from('vendor')
    .select('id, name, category, preferred_list, notes')
    .order('name');
  if (error) throw error;
  return (data ?? []).map((v: any) => ({
    id: v.id, name: v.name ?? null, category: v.category ?? null, preferredList: v.preferred_list ?? null, notes: v.notes ?? null,
  }));
}

/** Every tag in use across all events — the global option list for tag pickers. */
/** Managed list of event format (gathering type) options. */
export async function listFormats(): Promise<string[]> {
  const { data, error } = await supabase.from('format_catalog').select('name');
  if (error) throw error;
  return (data ?? []).map((r: any) => r.name as string).sort((a, b) => a.localeCompare(b));
}
export async function addFormat(name: string): Promise<void> {
  const n = name.trim();
  if (!n) return;
  const { error } = await supabase.from('format_catalog').insert({ name: n });
  if (error && !String(error.message ?? '').toLowerCase().includes('duplicate')) throw error;
}
/** Snap a (possibly comma-joined) format to the existing vocabulary before it's stored, so
 *  every created event/template reuses the closest existing format rather than minting a
 *  near-duplicate ("Community run + coffee" → "Run"). Genuinely-new formats join the catalog. */
export async function canonicalizeFormat(format: string | null | undefined): Promise<string | null> {
  if (!format || !format.trim()) return null;
  const tokens = format.split(',').map((s) => s.trim()).filter(Boolean);
  const { data } = await supabase.from('format_catalog').select('name');
  const catalog = (data ?? []).map((r: any) => r.name as string);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of tokens) {
    const m = matchFormat(tok, catalog);
    const key = m.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); out.push(m);
    if (!catalog.some((c) => c.toLowerCase() === key)) {
      try { await supabase.from('format_catalog').insert({ name: m }); catalog.push(m); } catch { /* dup/non-fatal */ }
    }
  }
  return out.join(', ') || null;
}
export async function removeFormat(name: string): Promise<void> {
  const { error } = await supabase.from('format_catalog').delete().eq('name', name);
  if (error) throw error;
}
/** Set an event's format (the chosen gathering type). */
export async function setEventFormat(eventId: string, format: string | null): Promise<void> {
  await updateEvent(eventId, { format });
}

/** Manually set (or clear → null = auto) an event's focus, overriding the keyword classifier. */
export async function setEventFocus(eventId: string, focus: EventFocus | null): Promise<void> {
  const { error } = await supabase.from('event').update({ focus_override: focus }).eq('id', eventId);
  if (error) throw error;
}

export async function getAllTags(): Promise<string[]> {
  const { data, error } = await supabase.from('event').select('tags');
  if (error) throw error;
  const set = new Set<string>();
  for (const row of data ?? []) for (const t of (row as any).tags ?? []) set.add(t);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** General edit of an event's name / description. */
export async function updateEvent(
  eventId: string,
  fields: {
    name?: string;
    description?: string | null;
    coverPosition?: string | null;
    format?: string | null;
    audience?: string | null;
    location?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    docLink?: string | null;
  },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if ('name' in fields) patch.name = fields.name;
  if ('docLink' in fields) patch.doc_link = fields.docLink;
  if ('description' in fields) patch.description = fields.description;
  if ('coverPosition' in fields) patch.cover_position = fields.coverPosition;
  if ('format' in fields) patch.format = fields.format;
  if ('audience' in fields) patch.audience = fields.audience;
  if ('location' in fields) patch.location = fields.location;
  if ('startTime' in fields) patch.start_time = fields.startTime;
  if ('endTime' in fields) patch.end_time = fields.endTime;
  const { error } = await supabase.from('event').update(patch).eq('id', eventId);
  if (error) throw error;
  // Calendar-relevant fields changed — auto-sync (server guards eligibility / template check).
  const calendarFields: (keyof typeof fields)[] = ['name', 'location', 'startTime', 'endTime', 'description'];
  if (calendarFields.some((f) => f in fields)) autoSyncGcal(eventId);
}

/** Update an event/template's pattern fields (jsonb). Used when re-saving from the review page so
 *  edits land on the EXISTING event instead of spawning a duplicate. */
export async function setEventPattern(
  eventId: string,
  fields: { phases?: { name: string; order: number }[]; planningLeadTime?: string | null; heuristics?: string[]; outreach?: OutreachTemplate[]; walkthrough?: WalkStep[] },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if ('phases' in fields) patch.phases = fields.phases ?? [];
  if ('planningLeadTime' in fields) patch.planning_lead_time = fields.planningLeadTime ?? null;
  if ('heuristics' in fields) patch.heuristics = fields.heuristics ?? [];
  if ('outreach' in fields) patch.outreach = fields.outreach ?? [];
  if ('walkthrough' in fields) patch.walkthrough = fields.walkthrough ?? [];
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from('event').update(patch).eq('id', eventId);
  if (error) throw error;
}

// ── Reflections (editable) ──────────────────────────────────────────────────
export interface Reflection { id: string; body: string; }

export async function addReflection(seriesId: string, body: string): Promise<Reflection> {
  const id = 'ref-' + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
  const { error } = await supabase.from('reflection').insert({ id, series_id: seriesId, body });
  if (error) throw error;
  return { id, body };
}
export async function updateReflection(id: string, body: string): Promise<void> {
  const { error } = await supabase.from('reflection').update({ body }).eq('id', id);
  if (error) throw error;
}
export async function deleteReflection(id: string): Promise<void> {
  const { error } = await supabase.from('reflection').delete().eq('id', id);
  if (error) throw error;
}

// ── Budget lines (editable) ─────────────────────────────────────────────────
export async function addBudgetLine(budgetId: string, label: string, amount: number | null): Promise<BudgetLineView> {
  const id = 'bl-' + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
  const { error } = await supabase
    .from('budget_line')
    .insert({ id, budget_id: budgetId, label, confirmed_amount: amount });
  if (error) throw error;
  return { id, label, confirmedAmount: amount, linkedEngagement: null, isUncategorized: false, note: null };
}
export async function updateBudgetLine(id: string, fields: { label?: string; amount?: number | null; note?: string | null }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if ('label' in fields) patch.label = fields.label;
  if ('amount' in fields) patch.confirmed_amount = fields.amount;
  if ('note' in fields) patch.note = fields.note;
  const { error } = await supabase.from('budget_line').update(patch).eq('id', id);
  if (error) throw error;
}
export async function deleteBudgetLine(id: string): Promise<void> {
  const { error } = await supabase.from('budget_line').delete().eq('id', id);
  if (error) throw error;
}

// ── Labels / folders ────────────────────────────────────────────────────────
export type LabelScope = 'event' | 'person';
export interface Label {
  id: string;
  name: string;
  scope: LabelScope;
}

export async function listLabels(scope: LabelScope): Promise<Label[]> {
  const { data, error } = await supabase
    .from('label')
    .select('id, name, scope')
    .eq('scope', scope)
    .order('name');
  if (error) throw error;
  return (data ?? []) as Label[];
}

export async function createLabel(name: string, scope: LabelScope): Promise<Label> {
  const id = 'lbl-' + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
  const { data, error } = await supabase.from('label').insert({ id, name, scope }).select('id, name, scope').single();
  if (error) throw error;
  return data as Label;
}

const joinFor = (scope: LabelScope) =>
  scope === 'event'
    ? { table: 'event_label', col: 'event_id' as const }
    : { table: 'attendee_label', col: 'attendee_id' as const };

export async function addLabel(scope: LabelScope, itemId: string, labelId: string): Promise<void> {
  const { table, col } = joinFor(scope);
  const { error } = await supabase.from(table).insert({ label_id: labelId, [col]: itemId });
  if (error && error.code !== '23505') throw error; // ignore duplicate
}

export async function removeLabel(scope: LabelScope, itemId: string, labelId: string): Promise<void> {
  const { table, col } = joinFor(scope);
  const { error } = await supabase.from(table).delete().eq('label_id', labelId).eq(col, itemId);
  if (error) throw error;
}

// ── People ────────────────────────────────────────────────────────────────────
export interface PersonView {
  id: string;
  name: string | null;
  email: string | null;
  title: string | null;
  org: string | null;
  type: string | null; // Client / Hire / Partner / Investor / Unknown
  isAggregate: boolean;
  countEst: string | null;
  note: string | null;
  school: string | null;
  city: string | null;
  industry: string | null;
  linkedinUrl: string | null;
  photoUrl: string | null;
  labelIds: string[];
  isInternal: boolean; // InstaLILY staff — explicit flag OR an @instalily.ai email
  crewRole: CrewRole; // stable role, shared taxonomy with the series roster (eng/growth/marketing/leadership/none)
  eventsCount: number; // attendance frequency (all-people view)
  eventDates: string[]; // dates of events attended (all-people view)
  eventCities: string[]; // distinct cities of events attended (all-people view) — drives the city tabs
  // Greenhouse read-back (thin, admin-gated): cached application status flag, matched by email.
  applicationStatus: string | null; // 'applied' | 'in_pipeline' | 'hired' | null
  greenhouseLastSynced: string | null;
  // event-scoped (only populated in the per-event view):
  role?: string;
  registrationStatus?: string | null;
  checkedIn?: boolean;
}

export interface EventTurnout {
  id: string;
  name: string;
  rsvp: number | null;
  capacity: number | null;
  checkedIn: number | null;
  waitlistAdmitted: number | null;
}

export async function getEventTurnout(eventId: string): Promise<EventTurnout | null> {
  const { data, error } = await supabase
    .from('event')
    .select('id, name, rsvp, capacity, checked_in, waitlist_admitted')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    rsvp: data.rsvp,
    capacity: data.capacity,
    checkedIn: data.checked_in,
    waitlistAdmitted: data.waitlist_admitted,
  };
}

export interface PeopleStats {
  total: number;
  registered: number; // Luma "approved"
  checkedIn: number;
  waitlisted: number;
  pending: number;
  declined: number;
}

/** Tally live status counts from attendee↔event links. */
export function tallyStats(rows: { registrationStatus?: string | null; checkedIn?: boolean }[]): PeopleStats {
  const s: PeopleStats = { total: 0, registered: 0, checkedIn: 0, waitlisted: 0, pending: 0, declined: 0 };
  for (const r of rows) {
    s.total++;
    if (r.checkedIn) s.checkedIn++;
    switch ((r.registrationStatus ?? '').toLowerCase()) {
      case 'approved': s.registered++; break;
      case 'waitlist': s.waitlisted++; break;
      case 'pending':
      case 'pending_approval': s.pending++; break;
      case 'declined': s.declined++; break;
    }
  }
  return s;
}

/** Live people stats for one event, computed from the synced Luma statuses. */
export async function getEventPeopleStats(eventId: string): Promise<PeopleStats> {
  const { data, error } = await supabase
    .from('attendee_event')
    .select('registration_status, checked_in')
    .eq('event_id', eventId);
  if (error) throw error;
  return tallyStats((data ?? []).map((r: any) => ({ registrationStatus: r.registration_status, checkedIn: r.checked_in })));
}

/** All attendees, with attendance frequency (count of events they're linked to). */
export async function listAllAttendees(): Promise<PersonView[]> {
  const { data, error } = await supabase
    .from('attendee')
    .select('id, name, email, title, org, type, is_aggregate, count_est, note, school, city, industry, linkedin_url, photo_url, is_internal, crew_role, application_status, greenhouse_last_synced, attendee_label ( label_id ), attendee_event ( event:event ( event_date, location ) )')
    .order('name', { nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => {
    const links = r.attendee_event ?? [];
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      title: r.title,
      org: r.org,
      type: r.type,
      isAggregate: r.is_aggregate ?? false,
      countEst: r.count_est,
      note: r.note,
      school: r.school ?? null,
      city: r.city ?? null,
      industry: r.industry ?? null,
      linkedinUrl: r.linkedin_url ?? null,
      photoUrl: r.photo_url ?? null,
      labelIds: (r.attendee_label ?? []).map((l: any) => l.label_id),
      isInternal: (r.is_internal ?? false) || isInternalEmail(r.email),
      crewRole: coerceRole(r.crew_role),
      eventsCount: links.length,
      eventDates: links.map((l: any) => l.event?.event_date).filter(Boolean),
      eventCities: Array.from(new Set(links.map((l: any) => l.event?.location).filter(Boolean))),
      applicationStatus: r.application_status ?? null,
      greenhouseLastSynced: r.greenhouse_last_synced ?? null,
    };
  });
}

export interface InternalPerson { id: string; name: string | null; email: string | null; crewRole: CrewRole; }

/** Internal contacts (InstaLILY staff) for the series person bank — explicit flag or @instalily.ai email. */
export async function listInternalPeople(): Promise<InternalPerson[]> {
  const { data, error } = await supabase
    .from('attendee')
    .select('id, name, email, is_internal, crew_role')
    .order('name', { nullsFirst: false });
  if (error) throw error;
  return (data ?? [])
    .filter((r: any) => (r.is_internal ?? false) || isInternalEmail(r.email))
    .map((r: any) => ({ id: r.id, name: r.name, email: r.email, crewRole: coerceRole(r.crew_role) }));
}

/** Attendees linked to one event, with their per-event role + Luma status. */
export async function listAttendeesForEvent(eventId: string): Promise<PersonView[]> {
  const { data, error } = await supabase
    .from('attendee_event')
    .select('role_at_event, registration_status, checked_in, attendee:attendee ( id, name, email, title, org, type, is_aggregate, count_est, note, school, city, industry, linkedin_url, photo_url, is_internal, crew_role, application_status, greenhouse_last_synced, attendee_label ( label_id ), attendee_event ( count ) )')
    .eq('event_id', eventId);
  if (error) throw error;
  return (data ?? []).map((l: any) => ({
    id: l.attendee?.id,
    name: l.attendee?.name,
    email: l.attendee?.email,
    title: l.attendee?.title,
    org: l.attendee?.org,
    type: l.attendee?.type,
    isAggregate: l.attendee?.is_aggregate ?? false,
    countEst: l.attendee?.count_est,
    note: l.attendee?.note,
    school: l.attendee?.school ?? null,
    city: l.attendee?.city ?? null,
    industry: l.attendee?.industry ?? null,
    linkedinUrl: l.attendee?.linkedin_url ?? null,
    photoUrl: l.attendee?.photo_url ?? null,
    labelIds: (l.attendee?.attendee_label ?? []).map((x: any) => x.label_id),
    isInternal: (l.attendee?.is_internal ?? false) || isInternalEmail(l.attendee?.email),
    crewRole: coerceRole(l.attendee?.crew_role),
    eventsCount: l.attendee?.attendee_event?.[0]?.count ?? 0,
    eventDates: [],
    eventCities: [],
    applicationStatus: l.attendee?.application_status ?? null,
    greenhouseLastSynced: l.attendee?.greenhouse_last_synced ?? null,
    role: l.role_at_event,
    registrationStatus: l.registration_status ?? null,
    checkedIn: l.checked_in ?? false,
  }));
}

export interface PersonEvent {
  eventId: string;
  eventName: string;
  date: string | null;
  tag: string | null;
  seriesName: string | null;
  role: string;
  registrationStatus: string | null;
  checkedIn: boolean;
}

/** Every event a person is linked to — their cross-event history. */
export async function getPersonEvents(attendeeId: string): Promise<PersonEvent[]> {
  const { data, error } = await supabase
    .from('attendee_event')
    .select('role_at_event, registration_status, checked_in, event:event ( id, name, event_date, tag, series:event_series ( name ) )')
    .eq('attendee_id', attendeeId);
  if (error) throw error;
  return (data ?? [])
    .map((l: any) => ({
      eventId: l.event?.id,
      eventName: l.event?.name,
      date: l.event?.event_date ?? null,
      tag: l.event?.tag ?? null,
      seriesName: l.event?.series?.name ?? null,
      role: l.role_at_event ?? 'attendee',
      registrationStatus: l.registration_status ?? null,
      checkedIn: l.checked_in ?? false,
    }))
    // Latest first; undated last.
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

// Auto-tag InstaLILY staff: any @instalily.ai email gets the "Internal" person label.
async function labelInternalIfInstalily(attendeeId: string, email: string | null): Promise<string | null> {
  if (!email || !email.trim().toLowerCase().endsWith('@instalily.ai')) return null;
  let id: string | null = null;
  const { data } = await supabase.from('label').select('id').eq('scope', 'person').ilike('name', 'internal').limit(1);
  id = data?.[0]?.id ?? null;
  if (!id) { id = 'lbl-internal'; await supabase.from('label').insert({ id, name: 'Internal', scope: 'person' }).then(() => {}, () => {}); }
  await supabase.from('attendee_label').insert({ attendee_id: attendeeId, label_id: id }).then(() => {}, () => {});
  return id;
}

// ── Attendees: manual add, headshots, per-event speaker tagging ──────────────
export async function addAttendee(eventId: string, fields: { name: string; title?: string | null; org?: string | null; email?: string | null; isSpeaker?: boolean }): Promise<PersonView> {
  const id = newId('att');
  const internal = isInternalEmail(fields.email ?? null);
  const { error: aErr } = await supabase.from('attendee').insert({
    id, name: fields.name, title: fields.title ?? null, org: fields.org ?? null, email: fields.email ?? null, type: 'Unknown',
    is_internal: internal,
  });
  if (aErr) throw aErr;
  const { error: lErr } = await supabase.from('attendee_event').insert({
    id: newId('ae'), attendee_id: id, event_id: eventId, role_at_event: fields.isSpeaker ? 'speaker' : 'attendee',
  });
  if (lErr) throw lErr;
  await graduateFromConcept(eventId);
  const internalId = await labelInternalIfInstalily(id, fields.email ?? null);
  return {
    id, name: fields.name, email: fields.email ?? null, title: fields.title ?? null, org: fields.org ?? null,
    type: 'Unknown', isAggregate: false, countEst: null, note: null, school: null, city: null, industry: null,
    linkedinUrl: null, photoUrl: null, labelIds: internalId ? [internalId] : [], isInternal: internal, crewRole: 'none', eventsCount: 1, eventDates: [], eventCities: [],
    applicationStatus: null, greenhouseLastSynced: null,
    role: fields.isSpeaker ? 'speaker' : 'attendee', registrationStatus: null, checkedIn: false,
  };
}

/** Set a person's stable crew role (shared taxonomy with the series roster). */
export async function setPersonCrewRole(attendeeId: string, role: CrewRole): Promise<void> {
  const { error } = await supabase.from('attendee').update({ crew_role: role }).eq('id', attendeeId);
  if (error) throw error;
}

/**
 * Create a global internal person (no event link) — used by the People page "Add internal person"
 * flow. `is_internal` is forced true so they show under the Internal tab even if the email is edited
 * to a non-instalily address. Also applies the "Internal" label when the email is @instalily.ai.
 */
export async function createInternalPerson(fields: { name: string; email?: string | null; crewRole?: CrewRole }): Promise<PersonView> {
  const id = newId('att');
  const email = fields.email?.trim() || null;
  const crewRole = fields.crewRole ?? 'none';
  const { error } = await supabase.from('attendee').insert({
    id, name: fields.name, email, type: 'Unknown', is_internal: true, crew_role: crewRole,
  });
  if (error) throw error;
  const internalId = await labelInternalIfInstalily(id, email);
  return {
    id, name: fields.name, email, title: null, org: null, type: 'Unknown', isAggregate: false, countEst: null,
    note: null, school: null, city: null, industry: null, linkedinUrl: null, photoUrl: null,
    labelIds: internalId ? [internalId] : [], isInternal: true, crewRole, eventsCount: 0, eventDates: [], eventCities: [],
    applicationStatus: null, greenhouseLastSynced: null,
  };
}

// A profile and an internal person with the same email are the SAME human. Ensure the person exists on
// the internal list: match by email → mark internal (+ optionally set their department); else create.
// `align` sets the department from the profile (used at profile creation); backfill leaves it alone.
// Escape LIKE/ILIKE wildcards so an email is matched literally (case-insensitively), not as a pattern.
const emailLike = (e: string) => e.replace(/([\\%_])/g, '\\$1');
export async function ensureInternalPerson(name: string, email: string | null, crewRole: CrewRole = 'none', opts: { align?: boolean } = {}): Promise<void> {
  const e = email?.trim() || null;
  if (e) {
    const { data } = await supabase.from('attendee').select('id, is_internal, crew_role').ilike('email', emailLike(e)).limit(1);
    const existing = (data ?? [])[0] as any;
    if (existing) {
      const patch: Record<string, unknown> = {};
      if (!existing.is_internal) patch.is_internal = true;
      if (opts.align && crewRole && crewRole !== 'none' && existing.crew_role !== crewRole) patch.crew_role = crewRole;
      if (Object.keys(patch).length) await supabase.from('attendee').update(patch).eq('id', existing.id);
      await labelInternalIfInstalily(existing.id, e);
      return;
    }
  }
  await createInternalPerson({ name, email: e, crewRole });
}

// One-time reconciliation: every EventHub profile should also be on the internal person list (linked by
// email). Creates the missing ones ('none' department) and marks email-matched attendees internal.
export async function backfillProfilesToPeople(): Promise<{ created: number; linked: number }> {
  const profiles = await listProfiles();
  let created = 0, linked = 0;
  for (const p of profiles) {
    const e = p.email?.trim() || null;
    if (e) {
      const { data } = await supabase.from('attendee').select('id, is_internal').ilike('email', emailLike(e)).limit(1);
      const existing = (data ?? [])[0] as any;
      if (existing) {
        if (!existing.is_internal) { await supabase.from('attendee').update({ is_internal: true }).eq('id', existing.id); await labelInternalIfInstalily(existing.id, e); }
        linked++;
        continue;
      }
    }
    await createInternalPerson({ name: p.name, email: e, crewRole: 'none' });
    created++;
  }
  return { created, linked };
}

/** Link an EXISTING person (attendee) to an event — the same attendee_event linkage addAttendee uses,
 *  but reusing the person record instead of creating a new one. Idempotent on (attendee, event). */
export async function linkAttendeeToEvent(eventId: string, attendeeId: string): Promise<void> {
  const { error } = await supabase.from('attendee_event').upsert(
    { id: newId('ae'), attendee_id: attendeeId, event_id: eventId, role_at_event: 'attendee' },
    { onConflict: 'attendee_id,event_id', ignoreDuplicates: true },
  );
  if (error) throw error;
  await graduateFromConcept(eventId);
}

export async function setAttendeePhoto(attendeeId: string, url: string | null): Promise<void> {
  const { error } = await supabase.from('attendee').update({ photo_url: url }).eq('id', attendeeId);
  if (error) throw error;
}

/** Toggle whether an attendee is a speaker for THIS event (per-event role). */
export async function setSpeakerRole(eventId: string, attendeeId: string, isSpeaker: boolean): Promise<void> {
  const { error } = await supabase.from('attendee_event')
    .update({ role_at_event: isSpeaker ? 'speaker' : 'attendee' })
    .eq('event_id', eventId).eq('attendee_id', attendeeId);
  if (error) throw error;
}

export async function reorderSpeakers(eventId: string, orderedAttendeeIds: string[]): Promise<void> {
  // Independent per-row updates (not a transaction — speaker order is cosmetic). Use allSettled
  // so every update runs even if one fails, then surface a failure so the user can re-drag: a
  // partial apply leaves duplicate speaker_order values that only a retry fixes.
  const results = await Promise.allSettled(orderedAttendeeIds.map((aid, i) =>
    supabase.from('attendee_event').update({ speaker_order: i }).eq('event_id', eventId).eq('attendee_id', aid)
      .then(({ error }) => { if (error) throw error; })));
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed.length) {
    console.error(`reorderSpeakers: ${failed.length}/${results.length} speaker_order updates failed`, failed.map((f) => f.reason));
    throw new Error('Speaker reorder partially failed — please drag again to fix.');
  }
}

export interface Speaker2 { attendeeId: string; name: string | null; title: string | null; org: string | null; photoUrl: string | null; linkedinUrl: string | null; }
/** Speakers for an event (role_at_event='speaker'), in speaker_order. */
export async function listEventSpeakers(eventId: string): Promise<Speaker2[]> {
  const { data, error } = await supabase
    .from('attendee_event')
    .select('speaker_order, attendee:attendee ( id, name, title, org, photo_url, linkedin_url )')
    .eq('event_id', eventId).eq('role_at_event', 'speaker');
  if (error) throw error;
  return (data ?? [])
    .map((l: any) => ({ _o: l.speaker_order ?? 9999, attendeeId: l.attendee?.id, name: l.attendee?.name ?? null, title: l.attendee?.title ?? null, org: l.attendee?.org ?? null, photoUrl: l.attendee?.photo_url ?? null, linkedinUrl: l.attendee?.linkedin_url ?? null }))
    .sort((a, b) => a._o - b._o)
    .map(({ _o, ...s }) => s);
}

/** Remove a person from an event; deletes the orphaned attendee if no links remain. */
export async function removeAttendeeFromEvent(eventId: string, attendeeId: string): Promise<void> {
  const { error } = await supabase.from('attendee_event').delete().eq('event_id', eventId).eq('attendee_id', attendeeId);
  if (error) throw error;
  const { data } = await supabase.from('attendee_event').select('id').eq('attendee_id', attendeeId).limit(1);
  if (!data || data.length === 0) await supabase.from('attendee').delete().eq('id', attendeeId);
}

/** Hard-delete a person entirely (used to remove internal teammates who've left). Removes their event
 *  links first — attendee_event has no ON DELETE CASCADE — then the attendee (labels/notes/tags cascade). */
export async function deleteAttendee(attendeeId: string): Promise<void> {
  await supabase.from('attendee_event').delete().eq('attendee_id', attendeeId);
  const { error } = await supabase.from('attendee').delete().eq('id', attendeeId);
  if (error) throw error;
}

/** Upload a custom cover: stores it + makes it the active cover (keeps any Luma cover). */
export async function updateEventCover(eventId: string, url: string | null): Promise<void> {
  const { error } = await supabase.from('event').update({ custom_cover_url: url, cover_image_url: url }).eq('id', eventId);
  if (error) throw error;
}

/** Toggle which source is the active/displayed cover (Luma ⇄ custom). */
export async function setActiveCover(eventId: string, url: string | null): Promise<void> {
  const { error } = await supabase.from('event').update({ cover_image_url: url }).eq('id', eventId);
  if (error) throw error;
}

/** Set the event's reference links. */
export async function setEventReferenceLinks(eventId: string, links: ReferenceLink[]): Promise<void> {
  const { error } = await supabase.from("event").update({ reference_links: links }).eq("id", eventId);
  if (error) throw error;
}

/** Add / remove an owner (profile) on an event. */
export async function addEventOwner(eventId: string, profileId: string): Promise<void> {
  const { error } = await supabase.from('event_owner').insert({ id: newId('eo'), event_id: eventId, profile_id: profileId });
  if (error) throw error;
}
export async function removeEventOwner(eventId: string, profileId: string): Promise<void> {
  const { error } = await supabase.from('event_owner').delete().eq('event_id', eventId).eq('profile_id', profileId);
  if (error) throw error;
}

// ── Owner todos (Home dashboard) ──────────────────────────────────────────────
export interface OwnerTodo { id: string; title: string; eventId: string; eventName: string; dueDate: string | null; phase: string | null; phaseOrder: number }
/** Upcoming (not-done) deliverables across the events this profile owns. Ordered by the
 *  earliest unfinished PHASE first (e.g. "Plan it" before "Day-of"), then soonest due — so
 *  the most urgent, earliest-phase work surfaces on top. Templates excluded. */
export async function listOwnerTodos(profileId: string): Promise<OwnerTodo[]> {
  const { data: owned, error: oErr } = await supabase
    .from('event_owner')
    .select('event:event ( id, name, is_template, phases, settle_state, macro_stage, event_date )')
    .eq('profile_id', profileId);
  if (oErr) throw oErr;
  // Home shows only LIVE work: drop templates, wrapped/settled events, and anything past by date —
  // a backfilled/finished event's open to-dos aren't upcoming work and shouldn't nag on Home.
  const todayIso = new Date().toISOString().slice(0, 10);
  const events = (owned ?? []).map((r: any) => r.event).filter((e: any) =>
    e && !e.is_template && e.settle_state !== 'settled' && e.macro_stage !== 'Wrapped' && !(e.event_date && e.event_date < todayIso));
  const nameById = new Map<string, string>(events.map((e: any) => [e.id, e.name]));
  const phasesById = new Map<string, { name: string; order: number }[]>(events.map((e: any) => [e.id, Array.isArray(e.phases) ? e.phases : []]));
  const ids = [...nameById.keys()];
  if (ids.length === 0) return [];
  const { data: dels, error: dErr } = await supabase
    .from('deliverable')
    .select('id, title, phase, resolved_due_date, status, event_id')
    .in('event_id', ids)
    .neq('status', 'Done');
  if (dErr) throw dErr;
  return (dels ?? [])
    .map((d: any) => {
      const phs = phasesById.get(d.event_id) ?? [];
      const idx = phs.findIndex((p) => p.name === (d.phase ?? ''));
      const phaseOrder = idx >= 0 ? (phs[idx].order ?? idx) : 99; // unphased → last
      return { id: d.id, title: d.title, eventId: d.event_id, eventName: nameById.get(d.event_id) ?? '', dueDate: d.resolved_due_date ?? null, phase: d.phase ?? null, phaseOrder };
    })
    // Earliest phase first; then soonest due (undated last).
    .sort((a, b) => (a.phaseOrder - b.phaseOrder) || (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99'));
}

// ── Threaded notes ──────────────────────────────────────────────────────────
export interface Note {
  id: string;
  attendeeId: string;
  body: string;
  contributor: string | null; // null until auth populates it
  createdAt: string;
}

export async function listNotes(attendeeId: string): Promise<Note[]> {
  const { data, error } = await supabase
    .from('attendee_note')
    .select('id, attendee_id, body, contributor, created_at')
    .eq('attendee_id', attendeeId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    attendeeId: r.attendee_id,
    body: r.body,
    contributor: r.contributor ?? null,
    createdAt: r.created_at,
  }));
}

export async function addNote(attendeeId: string, body: string, contributor: string | null = null): Promise<Note> {
  const id = 'note-' + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
  const { data, error } = await supabase
    .from('attendee_note')
    .insert({ id, attendee_id: attendeeId, body, contributor })
    .select('id, attendee_id, body, contributor, created_at')
    .single();
  if (error) throw error;
  return { id: data.id, attendeeId: data.attendee_id, body: data.body, contributor: data.contributor ?? null, createdAt: data.created_at };
}

/** Edit a person's free-text context (notes, manually-added LinkedIn). */
export async function updateAttendee(
  id: string,
  fields: { note?: string | null; linkedinUrl?: string | null; title?: string | null; org?: string | null; type?: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if ('note' in fields) patch.note = fields.note;
  if ('linkedinUrl' in fields) patch.linkedin_url = fields.linkedinUrl;
  if ('title' in fields) patch.title = fields.title;   // speaker role
  if ('org' in fields) patch.org = fields.org;         // speaker company
  if ('type' in fields) patch.type = fields.type;      // Client / Hire / Partner / … (post-event tagging)
  const { error } = await supabase.from('attendee').update(patch).eq('id', id);
  if (error) throw error;
}

// ── Claude-generated planning template ──────────────────────────────────────
export interface GeneratedTemplate {
  // Best-effort fields parsed from the description; null when not stated.
  name?: string | null;
  location?: string | null;
  date?: string | null;
  vendorCategories: string[];
  budgetLines: { label: string; estimate: number }[];
  progressCategories: string[];
}

/** Generate a starter event template from a description (server-side Claude call). */
export async function generateTemplate(description: string): Promise<GeneratedTemplate> {
  const { data, error } = await supabase.functions.invoke('generate-template', { body: { description } });
  if (error) {
    const msg = (data as any)?.error ?? error.message ?? String(error);
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as GeneratedTemplate;
}

// One end-to-end contract with the extract-brief edge function. Strings come back as ""
// (not null) when the brief doesn't state them; numbers come back as null.
export interface SourceMaterial { name: string; url: string; type: string }
export interface WalkStep { title: string; rationale: string; phase: string; linkedKind: "deliverable" | "role" | null; linkedLabel: string; isCallout: boolean }
export interface OutreachTemplate { title: string; whenToUse: string; body: string }
export interface ExtractedBrief {
  title: string; owner: string; date: string; startTime: string; endTime: string; location: string;
  headcount: number | null; audience: string; format: string; tag: string | null;
  specificity: "event" | "template";
  overview: string; guardrails: string[]; heuristics: string[]; phases: string[];
  // `original` (template mode) = the pre-generalization text when a name/client/case-study was stripped.
  deliverables: { title: string; phase: string; offsetStart: number | null; offsetEnd: number | null; original?: string }[];
  droppedForTemplate?: { title: string; reason: string }[]; // template mode: too event-specific to keep
  vendors: string[]; staff: string[]; agenda: { time: string; title: string }[];
  walkthrough: WalkStep[]; outreach: OutreachTemplate[]; budgetTotal: number | null;
}
/** Extract a dropped brief into structured fields via Claude (server-side). Pass templateMode when
 *  the result feeds a TEMPLATE (e.g. backfill) — forces phase-by-function + name generalization even
 *  for a dated brief. */
export async function extractBrief(text: string, opts?: { templateMode?: boolean }): Promise<ExtractedBrief> {
  // Retry once on failure. A single transient blip (Anthropic 429/529, a slow call, a malformed
  // JSON response) would otherwise throw → the caller silently falls back to the regex parser,
  // which yields drastically less (≈1 phase, a fraction of the deliverables). One retry turns most
  // of those blips into a clean extraction.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    try {
      const { data, error } = await supabase.functions.invoke('extract-brief', { body: { text, templateMode: !!opts?.templateMode } });
      if (error) throw new Error((data as any)?.error ?? error.message ?? String(error));
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as ExtractedBrief;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// A debrief is a DIFFERENT document than a brief — backward-looking. Its own extractor returns
// debrief-shaped fields (lessons/follow-ups/outcome/actuals/people) with category-awareness.
export interface DebriefExtract {
  eventName: string;
  focus: 'hiring' | 'client' | 'community' | 'unclear';
  outcome: { verdict: string; worthRepeating: 'yes' | 'no' | 'unsure' | null; turnoutActual: number | null; turnoutNote: string };
  lessons: { text: string; proposedChange: string; area: string }[];
  followUps: { action: string; owner: string; person: string; dueOffset: number | null }[];
  peopleTags: { name: string; lens: TagLens; note: string; provenance: string }[];
  actuals: { line: string; amount: number | null; note: string }[];
}
/** Extract a post-event debrief transcript into structured fields via Claude (server-side). */
export async function extractDebrief(text: string): Promise<DebriefExtract> {
  const { data, error } = await supabase.functions.invoke('extract-debrief', { body: { text } });
  if (error) {
    const msg = (data as any)?.error ?? error.message ?? String(error);
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as DebriefExtract;
}
/** Feed debrief-extracted people into the People confirm-inbox as PROPOSED tags, matched to this
 *  event's attendees by name. Returns how many were proposed + any names that didn't match. */
export async function proposeTagsFromDebrief(eventId: string, people: { name: string; lens: TagLens; note: string; provenance: string }[]): Promise<{ proposed: number; unmatched: string[] }> {
  if (!people?.length) return { proposed: 0, unmatched: [] };
  const attendees = await listAttendeesForEvent(eventId);
  const byName = new Map<string, string>();
  for (const a of attendees) if (a.name) byName.set(a.name.trim().toLowerCase(), a.id);
  let proposed = 0; const unmatched: string[] = [];
  for (const p of people) {
    const id = byName.get((p.name ?? '').trim().toLowerCase());
    if (!id) { unmatched.push(p.name); continue; }
    try { await tagPerson(id, eventId, p.lens, { source: 'debrief', sourceRef: p.provenance || 'debrief', note: p.note || null, status: 'proposed' }); proposed++; } catch { /* skip one bad row */ }
  }
  return { proposed, unmatched };
}

// ── Backfill a past event from a dropped brief/debrief ───────────────────────
/** Merge a brief extraction (structure/pattern) + a debrief extraction (outcome/actuals) into
 *  the one shape the backfill flow needs. Runs both extractors; either may no-op. */
export async function extractForBackfill(text: string): Promise<BackfillExtract> {
  // A backfill feeds the reusable pattern → extract in TEMPLATE MODE: deliverables are phased by
  // function (not dumped in one bucket) and generalized (person/company names stripped).
  const [b, d] = await Promise.all([
    extractBrief(text, { templateMode: true }).catch(() => null),
    extractDebrief(text).catch(() => null),
  ]);
  if (!b && !d) throw new Error('Extraction failed — check the dropped file or paste the text.');
  // Numbers the LLM may miss in prose ("68 RSVP and 16 checked in") — pull them straight from text.
  const firstNum = (...res: RegExp[]): number | null => {
    for (const re of res) { const m = text.match(re); if (m) { const n = Number(m[1]); if (!Number.isNaN(n)) return n; } }
    return null;
  };
  // "N attended of M invited" is a common recap phrasing — pull both explicitly so we don't confuse
  // invited-vs-attended (e.g. "54 attended of 62 invited" must give invited 62, attended 54).
  const rsvpN = firstNum(/(\d+)\s*(?:rsvps?|registered|expected|sign[- ]?ups?|invited)\b/i, /\b(?:rsvps?|invited)\b\D{0,15}(\d+)/i);
  const checkedN = firstNum(/(\d+)\s*(?:checked[- ]?in|check[- ]?ins?|showed\s*up|attended|turnout)\b/i, /\b(?:checked[- ]?in|attended)\b\D{0,15}(\d+)/i);
  // Grab an explicit "Field: value" line (handles **bold** markdown) when the LLM misses it.
  const grab = (re: RegExp): string | null => { const m = text.match(re); return m ? (m[1].replace(/\*/g, '').trim() || null) : null; };
  return {
    name: (b?.title || d?.eventName || '').trim(),
    date: b?.date || null,
    location: (b?.location && b.location.trim()) || grab(/(?:location|venue)\**\s*[:：]\s*(.+)/i),
    owner: (b?.owner && b.owner.trim()) || grab(/(?:owner|organi[sz]er|host)\**\s*[:：]\s*(.+)/i),
    format: b?.format || null,
    tag: b?.tag ?? null,
    // Explicit "invited"/"attended" numbers in the text win — the LLM's headcount field conflates
    // invited vs. attended (it'll latch onto "dinner for 54" / "54 attended" and lose the 62 invited).
    headcount: rsvpN ?? b?.headcount ?? null,
    turnoutActual: checkedN ?? d?.outcome?.turnoutActual ?? null,
    budgetTotal: b?.budgetTotal ?? null,
    verdict: d?.outcome?.verdict || '',
    // Phase set = the brief's phases PLUS any distinct phase the deliverables were assigned to
    // (so a functional bucket like "Setup & check-in" exists as a band even if it wasn't a heading).
    phases: (() => {
      const set = [...(b?.phases ?? [])];
      for (const dl of b?.deliverables ?? []) if (dl.phase && !set.includes(dl.phase)) set.push(dl.phase);
      return set;
    })(),
    staffRoles: b?.staff ?? [],
    lessons: (d?.lessons ?? []).map((l) => l.proposedChange || l.text).filter(Boolean),
    heuristics: b?.heuristics ?? [],
    actuals: (d?.actuals ?? []).map((a) => ({ line: a.line, amount: a.amount })),
    deliverables: (b?.deliverables ?? []).filter((dl) => dl.title?.trim()).map((dl) => ({ title: dl.title, phase: dl.phase || '', original: dl.original || undefined })),
    droppedForTemplate: b?.droppedForTemplate ?? [],
    agenda: (b?.agenda ?? []).filter((a) => a.title?.trim()),
  };
}

/** Templates (is_template events) with just the pattern fields the matcher/adder need. */
export async function listTemplates(): Promise<TemplateLite[]> {
  const { data, error } = await supabase.from('event').select('id, name, format, tags, phases, staff_roles, reflections').eq('is_template', true);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id, name: r.name, format: r.format ?? null, tags: r.tags ?? [],
    phases: Array.isArray(r.phases) ? r.phases.map((p: any) => p?.name ?? p).filter(Boolean) : [],
    staffRoles: Array.isArray(r.staff_roles) ? r.staff_roles : [],
    reflections: Array.isArray(r.reflections) ? r.reflections : [],
  }));
}

const backfillTemplateInput = (x: BackfillExtract): GeneratedTemplate => ({
  vendorCategories: [],
  budgetLines: x.actuals.filter((a) => a.line).map((a) => ({ label: a.line, estimate: a.amount ?? 0 })),
  progressCategories: x.deliverables.map((d) => d.title), // fallback only; deliverables[] is passed with phases
});
// Backfill extracts in TEMPLATE MODE, so each deliverable carries BOTH the generalized `title` and
// the pre-strip `original`. Both variants keep the phase (assigned by function).
//  • the EVENT record keeps the SPECIFIC text (names/clients are correct for a real past event)
//  • the TEMPLATE gets the GENERALIZED text (no person/company names)
const eventDeliverables = (x: BackfillExtract) => x.deliverables.map((d) => ({ title: (d.original?.trim() || d.title), phase: d.phase }));
const templateDeliverables = (x: BackfillExtract) => x.deliverables.map((d) => ({ title: d.title, phase: d.phase }));

/** Cold-start: create a NEW template (is_template event) from the dropped event's pattern. */
export async function createTemplateFromExtract(x: BackfillExtract): Promise<string> {
  return createPlanningEvent({
    name: x.format ? `${x.format} template` : (x.name ? `${x.name} (template)` : 'Event template'),
    date: null, location: null, tags: x.tag ? [x.tag] : [], template: backfillTemplateInput(x),
    deliverables: templateDeliverables(x), // generalized — no names in the template
    format: x.format, phases: x.phases.map((name, order) => ({ name, order })),
    staffRoles: generalRoles(x.staffRoles), reflections: [...x.lessons, ...x.heuristics], isTemplate: true,
  });
}

/** Create the wrapped (settled, past) event record from the merged extract, pointed at a template. */
export async function backfillWrappedEvent(x: BackfillExtract, modeledOnTemplateId: string | null, ownerProfileId?: string | null): Promise<string> {
  const eventId = await createPlanningEvent({
    name: x.name || 'Backfilled event', date: x.date, location: x.location, tags: x.tag ? [x.tag] : [],
    template: backfillTemplateInput(x), deliverables: eventDeliverables(x), format: x.format, // specific text — the real event keeps names
    phases: x.phases.map((name, order) => ({ name, order })),
    staffRoles: x.staffRoles, reflections: [...x.lessons, ...x.heuristics],
    modeledOnEventId: modeledOnTemplateId, isTemplate: false,
  });
  // It's history → mark it wrapped + settled (and setup_complete so it opens on the wrapped
  // view, not the setup walkthrough), and fill the event-specific numbers we have.
  const patch: Record<string, unknown> = { macro_stage: 'Wrapped', settle_state: 'settled', settled_at: new Date().toISOString(), setup_complete: true };
  if (x.verdict.trim()) patch.verdict = x.verdict.trim();
  if (x.turnoutActual != null) patch.checked_in = x.turnoutActual;
  if (x.headcount != null) patch.rsvp = x.headcount;
  await supabase.from('event').update(patch).eq('id', eventId).then(() => {}, () => {});
  // Owner: an explicit profile chosen in the review step wins; otherwise match the named owner to a
  // profile (exact name/email, then fuzzy). No confident match → left unassigned.
  try {
    let ownerId = ownerProfileId ?? null;
    if (ownerId === undefined) ownerId = null;
    if (!ownerId && x.owner) {
      const profs = await listProfiles();
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const w = norm(x.owner);
      const match = profs.find((p) => p.name.toLowerCase() === x.owner!.trim().toLowerCase() || norm((p.email ?? '').split('@')[0]) === w)
        ?? profs.find((p) => { const n = norm(p.name); return n.length >= 3 && (n === w || n.startsWith(w) || w.startsWith(n)); });
      ownerId = match?.id ?? null;
    }
    if (ownerId) await addEventOwner(eventId, ownerId);
  } catch { /* non-fatal */ }
  return eventId;
}

/** Apply a REVIEWED backfill extract to an EXISTING event (drop-a-doc-onto-a-past-event → enrich).
 *  The modal pre-merges the extract with the event's current values, so the reviewed lists are the
 *  desired final state and get written wholesale; deliverables are added only when missing. */
export async function enrichExistingEvent(eventId: string, x: BackfillExtract, ownerProfileId?: string | null): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (x.name.trim()) patch.name = x.name.trim();
  if (x.location) patch.location = x.location;
  if (x.date) patch.event_date = x.date;
  if (x.headcount != null) patch.rsvp = x.headcount;
  if (x.turnoutActual != null) patch.checked_in = x.turnoutActual;
  if (x.verdict.trim()) patch.verdict = x.verdict.trim();
  if (Object.keys(patch).length) await supabase.from('event').update(patch).eq('id', eventId).then(() => {}, () => {});
  await setEventStaffRoles(eventId, x.staffRoles).catch(() => {});
  if (x.agenda.length) await setEventAgenda(eventId, x.agenda).catch(() => {});
  await setEventReflections(eventId, x.lessons).catch(() => {});
  const pattern: { phases?: { name: string; order: number }[]; heuristics?: string[] } = {};
  if (x.phases.length) pattern.phases = x.phases.map((name, order) => ({ name, order }));
  if (x.heuristics.length) pattern.heuristics = x.heuristics;
  if (Object.keys(pattern).length) await setEventPattern(eventId, pattern).catch(() => {});
  // Deliverables: add only what's not already present (by phase|title).
  const plan = await getEventPlanning(eventId).catch(() => null);
  const seen = new Set((plan?.deliverables ?? []).map((d) => `${(d.phase ?? '').toLowerCase()}|${d.title.trim().toLowerCase()}`));
  const firstPhase = x.phases[0] ?? plan?.phases[0]?.name ?? 'Planning';
  for (const d of x.deliverables) {
    const title = d.title?.trim(); if (!title) continue;
    const phase = d.phase || firstPhase;
    const key = `${phase.toLowerCase()}|${title.toLowerCase()}`;
    if (seen.has(key)) continue; seen.add(key);
    await addDeliverable(eventId, { title, phase, ownerRole: null, dueDate: null, offsetStart: null, offsetEnd: null }).catch(() => {});
  }
  // Owner: reviewer's pick wins, else fuzzy-match the named owner.
  try {
    let ownerId = ownerProfileId ?? null;
    if (!ownerId && x.owner) {
      const profs = await listProfiles();
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const w = norm(x.owner);
      const m = profs.find((p) => p.name.toLowerCase() === x.owner!.trim().toLowerCase() || norm((p.email ?? '').split('@')[0]) === w)
        ?? profs.find((p) => { const n = norm(p.name); return n.length >= 3 && (n === w || n.startsWith(w) || w.startsWith(n)); });
      ownerId = m?.id ?? null;
    }
    if (ownerId) await addEventOwner(eventId, ownerId);
  } catch { /* non-fatal */ }
}

/** Reset an event's IMPORTED / derived content back to a clean slate — deliverables (except the
 *  locked post-event reflection), phases, roles, agenda, learnings, walkthrough, outreach, budget
 *  lines, vendors, turnout, verdict, and attached source docs. Keeps the event's IDENTITY (name,
 *  date, location, tags, format, owners) and lifecycle. Use after a bad folder drop to start over. */
export async function resetEvent(eventId: string): Promise<void> {
  await supabase.from('deliverable').delete().eq('event_id', eventId).eq('locked', false).then(() => {}, () => {});
  await supabase.from('engagement').delete().eq('event_id', eventId).then(() => {}, () => {});
  const { data: bud } = await supabase.from('budget').select('id').eq('event_id', eventId).limit(1);
  const budgetId = (bud as any)?.[0]?.id as string | undefined;
  if (budgetId) await supabase.from('budget_line').delete().eq('budget_id', budgetId).then(() => {}, () => {});
  await supabase.from('event').update({
    phases: [], staff_roles: [], reflections: [], heuristics: [], walkthrough: [], outreach: [], agenda: [],
    role_assignments: {}, source_materials: [], rsvp: null, checked_in: null, headcount: null, verdict: null,
    overview_summary: null,
  }).eq('id', eventId).then(() => {}, () => {});
}

/** Point an event at an existing template (adopt it). */
export async function adoptTemplate(eventId: string, templateId: string): Promise<void> {
  const { error } = await supabase.from('event').update({ modeled_on_event_id: templateId }).eq('id', eventId);
  if (error) throw error;
}

/** Derive a NEW template from a concrete event's own pattern (one-off event → "derive a template"),
 *  and point the event at it. Returns the new template id. */
export async function deriveTemplateFromEvent(eventId: string): Promise<string> {
  const p = await getEventPlanning(eventId);
  if (!p) throw new Error('event not found');
  const templateId = await createPlanningEvent({
    name: p.format ? `${p.format} template` : `${p.title} (template)`,
    date: null, location: null, tags: p.tags, format: p.format,
    template: {
      vendorCategories: p.engagements.map((e) => e.category).filter((c): c is string => !!c),
      budgetLines: (p.budget?.lines ?? []).filter((l) => l.label).map((l) => ({ label: l.label as string, estimate: l.confirmedAmount ?? 0 })),
      progressCategories: p.deliverables.filter((d) => !d.locked).map((d) => d.title), // title-only fallback
    },
    // Pass deliverables WITH their phase so the template keeps its per-phase workstreams — the
    // title-only progressCategories above would otherwise collapse them all into the first phase.
    deliverables: p.deliverables.filter((d) => !d.locked).map((d) => ({ title: d.title, phase: d.phase })),
    phases: p.phases.map((ph, i) => ({ name: ph.name, order: (ph as any).order ?? i })),
    staffRoles: generalRoles(p.staffRoles), reflections: p.reflections, isTemplate: true,
  });
  await supabase.from('event').update({ modeled_on_event_id: templateId }).eq('id', eventId).then(() => {}, () => {});
  return templateId;
}

/** Apply CONFIRMED additions to an existing template (one-directional; never rewrites the template's
 *  existing pattern, never propagates to sibling past events). */
export async function applyTemplateAdditions(templateId: string, add: TemplateAdditions): Promise<void> {
  const { data } = await supabase.from('event').select('phases, staff_roles, reflections').eq('id', templateId).maybeSingle();
  const curPhases = (Array.isArray((data as any)?.phases) ? (data as any).phases : []).map((p: any) => ({ name: p?.name ?? p, order: p?.order }));
  const curRoles = Array.isArray((data as any)?.staff_roles) ? (data as any).staff_roles : [];
  const curRefl = Array.isArray((data as any)?.reflections) ? (data as any).reflections : [];
  // Role-aligned merge (single day-of, ordered, no duplicate roles) — never concatenate. Roles are
  // generalized on both sides so a personal name can never land in (or linger in) the template.
  const phases = mergePhaseList(curPhases, add.phases);
  const roles = generalRoles([...curRoles, ...add.roles]);
  const refl = Array.from(new Set([...curRefl, ...add.lessons]));
  const { error } = await supabase.from('event').update({ phases, staff_roles: roles, reflections: refl }).eq('id', templateId);
  if (error) throw error;
}

/** Enrich an already-wrapped event by FILLING gap fields from a freshly-dropped doc's extract.
 *  Only touches the fields passed in `fields` (the current gaps) — never overwrites existing data. */
export async function enrichEventFromExtract(eventId: string, x: BackfillExtract, fields: string[]): Promise<string[]> {
  const want = new Set(fields);
  const filled: string[] = []; // what actually changed → caller can report honestly
  // Best-effort per field: attempt each, keep going after a failure — but only report a field in
  // `filled` if its write actually landed (push inside the try). A swallowed failure must NOT read
  // back as success to the caller / user.
  if (want.has('date') && x.date) {
    try { await setEventDate(eventId, x.date); filled.push('date'); }
    catch (e) { console.error('enrichEventFromExtract: date fill failed', String(e)); }
  }
  const ev: Record<string, unknown> = {};
  if (want.has('location') && x.location) ev.location = x.location;
  if (want.has('turnout')) {
    if (x.headcount != null) ev.rsvp = x.headcount;
    if (x.turnoutActual != null) { ev.checked_in = x.turnoutActual; if (x.headcount == null) ev.headcount = x.turnoutActual; }
  }
  if (Object.keys(ev).length) {
    try {
      const { error } = await supabase.from('event').update(ev).eq('id', eventId);
      if (error) throw error;
      if ('location' in ev) filled.push('location');
      if ('rsvp' in ev || 'checked_in' in ev || 'headcount' in ev) filled.push('turnout');
    } catch (e) { console.error('enrichEventFromExtract: location/turnout fill failed', String(e)); }
  }
  if (want.has('outcome') && x.verdict.trim()) {
    try { await setEventVerdict(eventId, x.verdict); filled.push('outcome'); }
    catch (e) { console.error('enrichEventFromExtract: outcome fill failed', String(e)); }
  }
  if (want.has('agenda') && x.agenda?.length) {
    try { await setEventAgenda(eventId, x.agenda); filled.push('agenda'); }
    catch (e) { console.error('enrichEventFromExtract: agenda fill failed', String(e)); }
  }
  // Roles are additive — a dropped debrief often names who covered what. Merge in any NEW roles
  // regardless of whether roles was a requested gap; dedup case-insensitively against existing.
  if (x.staffRoles?.length) {
    try {
      const { data: rr } = await supabase.from('event').select('staff_roles').eq('id', eventId).maybeSingle();
      const cur: string[] = Array.isArray((rr as any)?.staff_roles) ? (rr as any).staff_roles : [];
      const seen = new Set(cur.map((s) => s.trim().toLowerCase()));
      const merged = [...cur];
      for (const r of x.staffRoles) { const t = (r ?? '').trim(); if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); merged.push(t); } }
      if (merged.length > cur.length) { await setEventStaffRoles(eventId, merged); filled.push('roles'); }
    } catch (e) { console.error('enrichEventFromExtract: roles fill failed', String(e)); }
  }
  // Owner — if the event has none yet, assign the named owner matched to a profile.
  if (x.owner) {
    try {
      const { data: ow } = await supabase.from('event_owner').select('profile_id').eq('event_id', eventId).limit(1);
      if (!((ow as any)?.length)) {
        const profs = await listProfiles();
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const w = norm(x.owner);
        const m = profs.find((p) => p.name.toLowerCase() === x.owner!.trim().toLowerCase() || norm((p.email ?? '').split('@')[0]) === w)
          ?? profs.find((p) => { const n = norm(p.name); return n.length >= 3 && (n === w || n.startsWith(w) || w.startsWith(n)); });
        if (m) { await addEventOwner(eventId, m.id); filled.push('owner'); }
      }
    } catch (e) { console.error('enrichEventFromExtract: owner fill failed', String(e)); }
  }
  if (want.has('budget') && x.actuals.some((a) => a.line)) {
    try { await addBudgetActuals(eventId, x.actuals.filter((a) => a.line).map((a) => ({ label: a.line, amount: a.amount }))); filled.push('budget'); }
    catch (e) { console.error('enrichEventFromExtract: budget fill failed', String(e)); }
  }
  // Lessons are always additive (a debrief's whole point) — append any not already recorded,
  // regardless of which gap fields were requested. Dedup case-insensitively against existing.
  if (x.lessons?.length) {
    const { data: er } = await supabase.from('event').select('reflections').eq('id', eventId).maybeSingle();
    const cur: string[] = Array.isArray((er as any)?.reflections) ? (er as any).reflections : [];
    const norm = (s: string) => s.trim().toLowerCase();
    const seen = new Set(cur.map(norm));
    const added: string[] = [];
    for (const l of x.lessons) { const t = (l ?? '').trim(); if (t && !seen.has(norm(t))) { seen.add(norm(t)); added.push(t); } }
    if (added.length) {
      try { await setEventReflections(eventId, [...cur, ...added]); filled.push(`${added.length} lesson${added.length === 1 ? '' : 's'}`); }
      catch (e) { console.error('enrichEventFromExtract: lessons fill failed', String(e)); }
    }
  }
  return filled;
}

/** Record ACTUAL spend (paid) on an event — used when a budget sheet is dropped to fill final
 *  spend. Ensures a budget exists; lines land as 'paid' so they count as final spend (not estimates).
 *  docUrl links the lines to the source doc they came from, so deleting that source cascades.
 *  Re-import-safe: dedups by EXACT line label (normalized) against existing lines AND within the
 *  drop, so re-dropping the same sheet UPDATES the amount instead of doubling it. NOTE: dedup is by
 *  exact label, NOT canonical category — an itemized sheet legitimately has several distinct lines
 *  in one category (e.g. "Food (dinner)" and "Beverage (wine + beer)" are both catering but are
 *  separate spend), and merging them by category would silently drop money. */
export async function addBudgetActuals(eventId: string, lines: { label: string; amount: number | null }[], docUrl?: string | null): Promise<number> {
  const usable = lines.filter((l) => l.label?.trim());
  if (!usable.length) return 0;
  const { data } = await supabase.from('budget').select('id').eq('event_id', eventId).limit(1);
  let budgetId = data?.[0]?.id as string | undefined;
  if (!budgetId) { budgetId = genId('bud'); const { error } = await supabase.from('budget').insert({ id: budgetId, event_id: eventId, currency: 'USD' }); if (error) throw error; }

  const labelKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const existing = await listBudgetLines(budgetId);
  const byKey = new Map<string, BudgetLineTracker>();
  for (const l of existing) if (l.label) byKey.set(labelKey(l.label), l);

  const seen = new Set<string>();
  const toInsert: Record<string, unknown>[] = [];
  let changed = 0;
  for (const l of usable) {
    const key = labelKey(l.label);
    if (seen.has(key)) continue; // collapse exact-duplicate rows within the same sheet
    seen.add(key);
    const match = byKey.get(key);
    if (match) {
      // Update the existing line's amount in place (as paid actuals), preserving its other fields.
      const { error } = await supabase.from('budget_line').update({ confirmed_amount: l.amount, payment_status: 'paid', doc_url: docUrl ?? match.docUrl ?? null }).eq('id', match.id);
      if (!error) changed++;
    } else {
      toInsert.push({ id: genId('bl'), budget_id: budgetId, label: l.label, confirmed_amount: l.amount, payment_status: 'paid', doc_url: docUrl ?? null });
    }
  }
  if (toInsert.length) { const { error } = await supabase.from('budget_line').insert(toInsert); if (error) throw error; }
  return toInsert.length + changed;
}

// ── Source materials (project context) ───────────────────────────────────────
/** Append a dropped doc to an event's source materials (project context). */
export async function getSourceMaterials(eventId: string): Promise<SourceMaterial[]> {
  const { data } = await supabase.from('event').select('source_materials').eq('id', eventId).maybeSingle();
  return Array.isArray((data as any)?.source_materials) ? (data as any).source_materials : [];
}

export async function addSourceMaterial(eventId: string, material: SourceMaterial): Promise<void> {
  const cur = await getSourceMaterials(eventId);
  // Don't re-attach the same file: dedupe by url, and by name (a re-upload gets a fresh url).
  if (cur.some((m) => m.url === material.url || m.name === material.name)) return;
  const { error } = await supabase.from('event').update({ source_materials: [...cur, material] }).eq('id', eventId);
  if (error) throw error;
  await graduateFromConcept(eventId);
}

/** Remove a source doc from project context. CASCADES everything derived SOLELY from it: budget
 *  lines created from it (by doc_url) are deleted; vendors (engagements) created from it are deleted
 *  and any budget line that was merely TAGGED with such a vendor is untagged (the line itself stays,
 *  since it came from a different source). So removing a vendor sheet leaves the event with no
 *  vendors from it, without disturbing budget amounts. Returns what was cleaned up. */
export async function deleteSourceMaterial(eventId: string, key: string): Promise<{ budgetLinesRemoved: number; vendorsRemoved: number }> {
  const cur = await getSourceMaterials(eventId);
  // `key` is the material NAME or its stored value. (Displayed URLs are signed at read time, so
  // callers pass the stable name; we resolve the STORED value here for the derived-data cascade.)
  const target = cur.find((m) => m.name === key || m.url === key);
  const url = target?.url ?? key; // stored value: a private-doc path or a legacy public URL
  const next = cur.filter((m) => m !== target);
  const { error } = await supabase.from('event').update({ source_materials: next }).eq('id', eventId);
  if (error) throw error;

  // Vendors (engagements) created from this doc → untag any budget lines pointing at them, drop
  // their candidates, then delete the engagements.
  const { data: engs } = await supabase.from('engagement').select('id').eq('event_id', eventId).eq('doc_url', url);
  const engIds = (engs ?? []).map((e: any) => e.id);
  let vendorsRemoved = 0;
  if (engIds.length) {
    await supabase.from('budget_line').update({ linked_engagement: null }).in('linked_engagement', engIds);
    await supabase.from('engagement_candidate').delete().in('engagement_id', engIds);
    const { data: delEng } = await supabase.from('engagement').delete().in('id', engIds).select('id');
    vendorsRemoved = delEng?.length ?? 0;
  }

  // Budget lines that CAME from this source doc (created from it).
  const { data: buds } = await supabase.from('budget').select('id').eq('event_id', eventId);
  let budgetLinesRemoved = 0;
  for (const b of buds ?? []) {
    const { data: del } = await supabase.from('budget_line').delete().eq('budget_id', b.id).eq('doc_url', url).select('id');
    budgetLinesRemoved += del?.length ?? 0;
  }
  return { budgetLinesRemoved, vendorsRemoved };
}

// ── Greenhouse read-back (thin, email-matched application status) ─────────────
export interface GreenhouseMatch { email: string; candidateId: string; status: "applied" | "in_pipeline" | "hired" | "none" }
/** Sync the cached Greenhouse application-status flag onto attendees by email (server-side,
 *  read-scoped key). Writes only the thin flag + last_synced — never pipeline detail. */
export async function syncGreenhouse(emails: string[]): Promise<{ configured: boolean; matched: number; synced: number; error?: string }> {
  const clean = Array.from(new Set(emails.filter(Boolean).map((e) => e.trim().toLowerCase()))).filter(Boolean);
  if (clean.length === 0) return { configured: true, matched: 0, synced: 0 };
  const { data, error } = await supabase.functions.invoke('greenhouse-sync', { body: { emails: clean } });
  if (error) return { configured: false, matched: 0, synced: 0, error: (data as any)?.error ?? error.message };
  if ((data as any)?.error) return { configured: false, matched: 0, synced: 0, error: (data as any).error };
  const matches: GreenhouseMatch[] = (data as any)?.matches ?? [];
  const byEmail = new Map(matches.map((m) => [m.email.toLowerCase(), m]));
  const now = new Date().toISOString();
  // Persist the thin flag. Match attendees case-insensitively on email; no match → leave the
  // status null (NOT "didn't apply" — they may have applied with a different address).
  for (const email of clean) {
    const m = byEmail.get(email);
    const patch = m && m.status !== "none"
      ? { greenhouse_candidate_id: m.candidateId, application_status: m.status, greenhouse_last_synced: now }
      : { greenhouse_candidate_id: m?.candidateId ?? null, application_status: null, greenhouse_last_synced: now };
    try { await supabase.from('attendee').update(patch).ilike('email', email); } catch { /* non-fatal */ }
  }
  return { configured: true, matched: matches.filter((m) => m.status !== "none").length, synced: clean.length };
}

/** Attach a Luma event from a pasted public link. Server-side resolution + write. */
export async function attachLuma(
  eventId: string,
  url: string,
): Promise<{ lumaEventId: string; name: string | null; coverImageUrl: string | null; lumaUrl: string }> {
  const { data, error } = await supabase.functions.invoke('attach-luma', { body: { eventId, url } });
  if (error) {
    // Surface the function's JSON error message when present.
    const msg = (data as any)?.error ?? error.message ?? String(error);
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as any;
}

/** Break the Luma link on an event: clears the stored Luma id/url/name/cover so it's no longer
 *  synced. Leaves the displayed cover and any already-pulled attendees in place. Re-link anytime
 *  with attachLuma (a new URL overwrites), or create a fresh Luma event. */
export async function unlinkLuma(eventId: string): Promise<void> {
  const { error } = await supabase.from('event').update({ luma_event_id: null, luma_url: null, luma_name: null, luma_cover_url: null }).eq('id', eventId);
  if (error) throw error;
}

/** Manual, add-only Luma re-pull for a single (wrapped/past) event — pulls in late guest additions
 *  only, never overwriting or removing existing attendees. Hits the luma-sync cloud function with an
 *  eventId (same endpoint the background sync uses; App fires it prefix-and-all). */
export async function resyncLumaEvent(eventId: string): Promise<{ added: number; linked: number }> {
  const res = await fetch('/functions/v1/luma-sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ eventId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error ?? `Resync failed (${res.status}).`);
  return { added: (data as any).added ?? 0, linked: (data as any).linked ?? 0 };
}

/** Create a brand-new Luma event from this event's info (name, date, start/end, location,
 *  description) via the Luma API, then attach it. Server-side — holds the Luma key. */
export async function createLumaEvent(
  eventId: string,
  overrides?: { name?: string; date?: string | null; startTime?: string | null; endTime?: string | null; location?: string | null; description?: string | null; timezone?: string },
): Promise<{ lumaEventId: string; name: string | null; lumaUrl: string; coverImageUrl: string | null }> {
  const { data, error } = await supabase.functions.invoke('create-luma', { body: { eventId, ...overrides } });
  if (error) {
    // supabase-js gives a generic message on non-2xx; the real error is in the response body.
    let msg = (data as any)?.error ?? error.message ?? String(error);
    try { const body = await (error as any).context?.json?.(); if (body?.error) msg = body.error; } catch { /* keep generic */ }
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as any;
}

/** Push this event onto the shared company Google Calendar (one toggleable secondary
 *  calendar under calendar@instalily.ai). Idempotent — re-running patches the same entry.
 *  Server-side holds the Google credentials. Requires the event to have a date. */
export async function syncEventToGoogleCalendar(
  eventId: string,
  action?: 'auto' | 'link' | 'create' | 'delete',
): Promise<{ ok?: boolean; status?: 'synced' | 'needs_confirmation' | 'partial'; gcalEventId?: string; calendarId?: string; htmlLink?: string | null; candidates?: Record<string, { gcalEventId?: string; summary: string; start: string; htmlLink: string; reason?: string } | null>; gcalEventIds?: Record<string, string>; errors?: unknown[] }> {
  const body: Record<string, unknown> = { eventId };
  if (action !== undefined) body.action = action;
  const appOrigin = typeof location !== 'undefined' ? location.origin : undefined;
  if (appOrigin !== undefined) body.appOrigin = appOrigin;
  const { data, error } = await supabase.functions.invoke('gcal-sync', { body });
  if (error) {
    let msg = (data as any)?.error ?? error.message ?? String(error);
    try { const body2 = await (error as any).context?.json?.(); if (body2?.error) msg = body2.error; } catch { /* keep generic */ }
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as any;
}

/** Resolve a pending gcal match by choosing to link or create. */
export async function resolveGcalMatch(eventId: string, decision: 'link' | 'create'): Promise<void> {
  const { error } = await supabase.functions.invoke('gcal-sync', { body: { eventId, action: decision, appOrigin: typeof location !== 'undefined' ? location.origin : undefined } });
  if (error) throw error;
}

/** Delete/unsync this event from Google Calendar (all calendars it was pushed to). */
export async function deleteEventFromGoogleCalendar(eventId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('gcal-sync', { body: { eventId, action: 'delete' } });
  if (error) throw error;
}

/** Fire-and-forget gcal auto-sync — never blocks the caller. */
function autoSyncGcal(eventId: string): void { void syncEventToGoogleCalendar(eventId).catch((e) => console.warn('gcal auto-sync failed', e)); }

/** Mirror this event + all its deliverables into Linear: the event becomes a Project under the
 *  single "EventHub" team, and each deliverable an Issue in that project. Idempotent — re-running
 *  updates existing issues. Server-side holds the Linear API key. */
export async function syncEventToLinear(
  eventId: string,
  opts?: { recreate?: boolean },
): Promise<{ teamId: string; projectId: string; projectUrl: string | null; synced: number; total: number; recreated: boolean }> {
  const { data, error } = await supabase.functions.invoke('linear-sync', { body: { eventId, recreate: opts?.recreate ?? false } });
  if (error) {
    let msg = (data as any)?.error ?? error.message ?? String(error);
    try { const body = await (error as any).context?.json?.(); if (body?.error) msg = body.error; } catch { /* keep generic */ }
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as any;
}

/** Verify this event's Linear project still exists (it may have been deleted in Linear). Powers the
 *  "Open in Linear" button so a dead project offers a re-sync instead of navigating to an empty page.
 *  linked=false ⇒ never synced; exists=false ⇒ was synced but the project is gone from Linear. */
export async function checkLinearProject(
  eventId: string,
): Promise<{ linked: boolean; exists: boolean; url: string | null }> {
  const { data, error } = await supabase.functions.invoke('linear-sync', { body: { eventId, direction: 'check' } });
  if (error) {
    let msg = (data as any)?.error ?? error.message ?? String(error);
    try { const body = await (error as any).context?.json?.(); if (body?.error) msg = body.error; } catch { /* keep generic */ }
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return { linked: !!(data as any).linked, exists: !!(data as any).exists, url: (data as any).url ?? null };
}

/** Pull the current Linear issue states back onto this event's deliverables (Linear → EventHub).
 *  Updates each linked deliverable's status to match its issue. Returns how many changed. */
export async function pullEventFromLinear(
  eventId: string,
): Promise<{ pulled: number; total: number }> {
  const { data, error } = await supabase.functions.invoke('linear-sync', { body: { eventId, direction: 'pull' } });
  if (error) {
    let msg = (data as any)?.error ?? error.message ?? String(error);
    try { const body = await (error as any).context?.json?.(); if (body?.error) msg = body.error; } catch { /* keep generic */ }
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as any;
}

/** Unlink this event from Linear: delete the Linear project AND every issue in it, then clear the
 *  linkage on the event + its deliverables. Server-side (holds the Linear API key). Idempotent — a
 *  project already gone in Linear still clears our side. */
export async function unlinkLinear(
  eventId: string,
): Promise<{ deletedIssues: number; deletedProject: boolean }> {
  const { data, error } = await supabase.functions.invoke('linear-sync', { body: { eventId, direction: 'unlink' } });
  if (error) {
    let msg = (data as any)?.error ?? error.message ?? String(error);
    try { const body = await (error as any).context?.json?.(); if (body?.error) msg = body.error; } catch { /* keep generic */ }
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return { deletedIssues: (data as any)?.deletedIssues ?? 0, deletedProject: !!(data as any)?.deletedProject };
}

/** Post an interactive budget-approval request (Approve/Decline buttons) to Slack. */
export async function postApprovalRequest(opts: { channel: string; eventId: string; summary: string; link: string; requestedAmount: number | null }): Promise<{ channel: string; ts: string }> {
  const res = await fetch('/functions/v1/slack-approval', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error ?? `Slack post failed (${res.status}).`);
  return { channel: (data as any).channel, ts: (data as any).ts };
}

/** List the Slack channels the bot can post to (member-of), for the by-name channel picker. */
export async function listSlackChannels(): Promise<{ id: string; name: string }[]> {
  try {
    const { data, error } = await supabase.functions.invoke('slack-channels', { body: {} });
    if (error || (data as any)?.error) return [];
    return ((data as any)?.channels ?? []) as { id: string; name: string }[];
  } catch {
    return [];
  }
}

/** Link an event to a Slack channel — either an existing one or a freshly-created private channel. */
export async function linkSlackChannel(
  eventId: string,
  arg: { channelId: string } | { create: { name: string } },
): Promise<{ id: string; name: string; skipped?: string[] }> {
  const { data, error } = await supabase.functions.invoke('slack-link-channel', { body: { eventId, ...arg } });
  if (error || (data as any)?.error) throw new Error((data as any)?.error ?? error?.message ?? 'link failed');
  return data as { id: string; name: string; skipped?: string[] };
}

/** Clear an event's Slack channel link. */
export async function unlinkSlackChannel(eventId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('slack-link-channel', { body: { eventId, channelId: null } });
  if (error || (data as any)?.error) throw new Error((data as any)?.error ?? error?.message ?? 'unlink failed');
}

// ── Slack captures (the pin-to-EventHub ledger) ──────────────────────────────
// A capture is one extracted planning fact routed to a "home". The Slack pin pipeline writes them
// as `proposed`; the Overview surfaces the proposed ones for confirm/edit/dismiss. Homes:
//   plan → run-of-show (Deliverables), person → Staffing/People, open → Open·next-up, budget → Budget.
export type CaptureHome = 'plan' | 'person' | 'vendor' | 'open' | 'budget';
export interface SlackCapture {
  id: string;
  home: CaptureHome;
  summary: string;
  detail: string | null;
  status: 'proposed' | 'confirmed' | 'dismissed';
  sourceRef: string | null;   // permalink back to the Slack message
  sourceQuote: string | null;
  flags: Record<string, unknown>;  // { conflict?: {field}, ambiguity?: string }
  createdAt: string;
}

/** The event's still-proposed captures, oldest first (so the reader sees them in arrival order). */
export async function listSlackCaptures(eventId: string): Promise<SlackCapture[]> {
  const { data, error } = await supabase
    .from('slack_capture')
    .select('id, home, summary, detail, status, source_ref, source_quote, flags, created_at')
    .eq('event_id', eventId)
    .eq('status', 'proposed')
    .order('created_at', { ascending: true });
  if (error) { console.warn('listSlackCaptures', error.message); return []; }
  return (data ?? []).map((r: any) => ({
    id: r.id, home: r.home, summary: r.summary, detail: r.detail ?? null, status: r.status,
    sourceRef: r.source_ref ?? null, sourceQuote: r.source_quote ?? null,
    flags: (r.flags as Record<string, unknown>) ?? {}, createdAt: r.created_at,
  }));
}

async function ensureBudgetId(eventId: string): Promise<string> {
  const { data } = await supabase.from('budget').select('id').eq('event_id', eventId).limit(1);
  let id = data?.[0]?.id as string | undefined;
  if (!id) { id = genId('bud'); const { error } = await supabase.from('budget').insert({ id, event_id: eventId, currency: 'USD' }); if (error) throw new Error(error.message); }
  return id;
}

/** An existing budget line for the event whose label matches this one (fuzzy), or null. Doesn't
 *  create a budget. Used to decide whether a confirmed budget capture merges or stands alone. */
export async function findBudgetLineMatch(eventId: string, label: string): Promise<BudgetLineTracker | null> {
  const { data } = await supabase.from('budget').select('id').eq('event_id', eventId).limit(1);
  const budgetId = data?.[0]?.id as string | undefined;
  if (!budgetId) return null;
  const lines = await listBudgetLines(budgetId);
  return lines.find((l) => l.label && labelsMatch(l.label, label)) ?? null;
}

/** Add a brand-new budget line (no merge). */
export async function insertBudgetLine(eventId: string, label: string, amount: number | null, status: BudgetStatus = 'quoted'): Promise<void> {
  const budgetId = await ensureBudgetId(eventId);
  const { error } = await supabase.from('budget_line').insert({
    id: genId('bl'), budget_id: budgetId, label, confirmed_amount: amount, payment_status: amount != null ? status : 'estimate',
  });
  if (error) throw new Error(error.message);
}

/** Overwrite a budget line's amount + status (used by Replace / Add merge choices). */
export async function setBudgetLineAmountStatus(id: string, amount: number | null, status: BudgetStatus): Promise<void> {
  const { error } = await supabase.from('budget_line').update({ confirmed_amount: amount, payment_status: status }).eq('id', id);
  if (error) throw new Error(error.message);
}

/** Higher of two budget statuses (a later quote shouldn't undo a 'paid'). */
export function maxBudgetStatus(a: BudgetStatus, b: BudgetStatus): BudgetStatus {
  return BUDGET_RANK[a] >= BUDGET_RANK[b] ? a : b;
}

/** Accept a proposed capture (it graduates out of the proposed list into its home's settled state). */
export async function confirmSlackCapture(id: string): Promise<void> {
  const { error } = await supabase.from('slack_capture').update({ status: 'confirmed' }).eq('id', id);
  if (error) throw new Error(error.message);
}

/** Re-route a proposed capture to a different home (fix a misclassification, e.g. person → vendor). */
export async function setCaptureHome(id: string, home: CaptureHome): Promise<void> {
  const { error } = await supabase.from('slack_capture').update({ home }).eq('id', id);
  if (error) throw new Error(error.message);
}

/** Reject a proposed capture (a misfire, or already handled elsewhere). */
export async function dismissSlackCapture(id: string): Promise<void> {
  const { error } = await supabase.from('slack_capture').update({ status: 'dismissed' }).eq('id', id);
  if (error) throw new Error(error.message);
}

/** Correct a capture's wording before confirming. */
export async function editSlackCapture(id: string, patch: { summary?: string; detail?: string | null }): Promise<void> {
  const { error } = await supabase.from('slack_capture').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Tutorials (admin-editable) ───────────────────────────────────────────────
// The whole tutorial structure lives as one JSON blob in app_setting.value (text). null = never
// saved yet → the page falls back to its built-in default seed. `icon` is a lucide name (string),
// mapped to a component in TutorialPage.
export interface TutorialWalkthrough {
  id: string; title: string; when: string; icon: string; length: string;
  embedUrl: string | null; status: 'ready' | 'soon' | 'planned'; aspect?: string | null;
}
export interface TutorialSection { id: string; heading: string; blurb: string; items: TutorialWalkthrough[] }

export async function getTutorials(): Promise<TutorialSection[] | null> {
  const { data, error } = await supabase.from('app_setting').select('value').eq('key', 'tutorials').maybeSingle();
  if (error) return null;
  const v = (data as any)?.value;
  if (!v) return null;
  try { return (typeof v === 'string' ? JSON.parse(v) : v) as TutorialSection[]; } catch { return null; }
}

export async function saveTutorials(sections: TutorialSection[]): Promise<void> {
  const { error } = await supabase.from('app_setting').upsert({ key: 'tutorials', value: JSON.stringify(sections) });
  if (error) throw error;
}

/** Post a message to a Slack channel via the bot token (server-side). */
export async function slackSend(channel: string, text: string): Promise<{ channel: string; ts: string }> {
  const { data, error } = await supabase.functions.invoke('slack-send', { body: { channel, text } });
  if (error) {
    let msg = (data as any)?.error ?? error.message ?? String(error);
    try { const body = await (error as any).context?.json?.(); if (body?.error) msg = body.error; } catch { /* keep generic */ }
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as any;
}

const EVENT_LIST_SELECT =
  'id, name, tag, tags, format, focus_override, location, office, event_date, end_date, start_time, end_time, rsvp, capacity, checked_in, headcount, verdict, agenda, staff_roles, macro_stage, settle_state, owning_team, status, is_template, is_external, quarter, why, info_url, owners:event_owner ( profile:profile ( id, name, color ) ), series_id, luma_event_id, luma_url, luma_name, gcal_event_id, gcal_html_link, slack_channel, cover_image_url, luma_cover_url, custom_cover_url, cover_position, event_label ( label_id ), series:event_series ( id, name, type, status, owning_team ), budget ( lines:budget_line ( confirmed_amount, payment_status ) ), engagement ( id )';

export async function listEvents(): Promise<EventListItem[]> {
  const { data, error } = await supabase
    .from('event')
    .select(EVENT_LIST_SELECT)
    // Exclude lightweight external conferences — they aren't operated events, so they must never
    // leak into the events list, Home, Budget, todos, etc. The Calendar opts them in separately.
    .eq('lightweight', false)
    .order('id');
  if (error) throw error;
  const items = (data ?? []).map(toListItem);
  // A record is "complete" strictly when its post-event reflections/insights deliverable is
  // Done — which happens EITHER automatically once the completeness list has no gaps, OR when
  // the user manually checks it off. Deliberately NOT keyed on "settled": a settled event can
  // still have gaps, and we don't want the green check next to a yellow "to add" list.
  const { data: reflDone } = await supabase
    .from('deliverable')
    .select('event_id')
    .eq('status', 'Done')
    .or('title.ilike.%reflection%,title.ilike.%insight%');
  const reflDoneSet = new Set((reflDone ?? []).map((d: any) => d.event_id));
  // A record shows the ✓ when it reads as COMPLETE — computed the SAME way as the event page's
  // completeness panel (completenessFields), so the two never disagree: no category-relevant gaps
  // left, OR the owner manually checked off the reflections deliverable. Only PAST events qualify
  // (a planning event isn't a "record" yet). Mirrors completenessFields() — keep the two in sync.
  const rows = data ?? [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const row = rows[i] as any;
    const focus = eventFocus(Array.isArray(row.tags) ? row.tags : [], row.format, row.focus_override ?? null);
    const budgetLines: any[] = Array.isArray(row.budget) ? (row.budget[0]?.lines ?? []) : (row.budget?.lines ?? []);
    const hasActual = budgetLines.some((l) => normBudgetStatus(l.payment_status) !== 'estimate' && (Number(l.confirmed_amount) || 0) > 0);
    const agenda = Array.isArray(row.agenda) ? row.agenda : [];
    const roles = Array.isArray(row.staff_roles) ? row.staff_roles : [];
    const vendors = Array.isArray(row.engagement) ? row.engagement.length : 0;
    const noGaps = !!row.event_date && !!row.location
      && (row.rsvp != null || row.headcount != null || row.checked_in != null)
      && hasActual
      && !!(row.verdict && String(row.verdict).trim())
      && agenda.length > 0
      && (focus === 'neither' || vendors > 0)
      && roles.length > 0;
    it.finalRecordComplete = it.status === 'past' && (noGaps || reflDoneSet.has(it.id));
  }
  return items;
}

// ── External conferences (lightweight "we're attending this") ─────────────────
/** External conferences only — the lightweight instances excluded from listEvents. For the calendar. */
export async function listExternalConferences(): Promise<EventListItem[]> {
  const { data, error } = await supabase.from('event').select(EVENT_LIST_SELECT).eq('is_external', true).order('event_date');
  if (error) throw error;
  return (data ?? []).map(toListItem);
}

export interface ExternalConferenceInput {
  name: string; startDate: string; endDate?: string | null;
  why?: string | null; quarter?: string | null; location?: string | null; infoUrl?: string | null;
  tag: string; // taxonomy tag, e.g. "Ext. Industry" | "Ext. PE"
}
/** Create a lightweight external-conference instance — a MINIMAL event row (is_external + lightweight),
 *  NOT via createPlanningEvent, so no budget/deliverables/phases/post-mortem are seeded. Attendees are
 *  added separately with addAttendee() so the linkage is the same one events use. Returns the id. */
export async function addExternalConference(input: ExternalConferenceInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('Name is required.');
  if (!input.startDate) throw new Error('Start date is required.');
  if (input.endDate && input.endDate < input.startDate) throw new Error('End date must be on or after the start date.');
  const id = newId('evt');
  const { error } = await supabase.from('event').insert({
    id, name, event_date: input.startDate, end_date: input.endDate || null,
    is_external: true, lightweight: true, is_template: false, macro_stage: null,
    location: input.location?.trim() || null, why: input.why?.trim() || null,
    quarter: input.quarter?.trim() || null, info_url: input.infoUrl?.trim() || null,
    tag: input.tag, tags: [input.tag],
  });
  if (error) throw error;
  // External conferences always have a date (required above) — auto-sync.
  autoSyncGcal(id);
  return id;
}

/** Edit an external-conference instance in place, then re-sync its calendar copies. Same field set
 *  as addExternalConference; attendee links are managed separately (link/add). */
export async function updateExternalConference(id: string, input: ExternalConferenceInput): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new Error('Name is required.');
  if (!input.startDate) throw new Error('Start date is required.');
  if (input.endDate && input.endDate < input.startDate) throw new Error('End date must be on or after the start date.');
  const { error } = await supabase.from('event').update({
    name, event_date: input.startDate, end_date: input.endDate || null,
    location: input.location?.trim() || null, why: input.why?.trim() || null,
    quarter: input.quarter?.trim() || null, info_url: input.infoUrl?.trim() || null,
    tag: input.tag, tags: [input.tag],
  }).eq('id', id);
  if (error) throw error;
  autoSyncGcal(id);
}

// ── Series / campaign helpers ──────────────────────────────────────────────
export interface SeriesCardEvent { id: string; title: string; date: string | null; location: string | null; coverImageUrl: string | null; }
export interface SeriesListItem { id: string; name: string; drive: Drive; memberCount: number; events: SeriesCardEvent[]; }
export interface SeriesEvent { id: string; name: string; date: string | null; location: string | null; eventBudgetTarget: number | null; startTime: string | null; endTime: string | null; }

export async function listSeries(): Promise<SeriesListItem[]> {
  const { data, error } = await supabase
    .from("event_series")
    .select("id, name, extras, events:event ( id, name, event_date, location, cover_image_url, custom_cover_url, luma_cover_url )")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((s: any) => {
    // Events fanned on the card, soonest first (undated last).
    const events: SeriesCardEvent[] = (Array.isArray(s.events) ? s.events : [])
      .map((e: any) => ({ id: e.id, title: e.name, date: e.event_date ?? null, location: e.location ?? null, coverImageUrl: e.custom_cover_url ?? e.cover_image_url ?? e.luma_cover_url ?? null }))
      .sort((a: SeriesCardEvent, b: SeriesCardEvent) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
    return { id: s.id, name: s.name, drive: normalizeCampaign(s.extras?.campaign).drive as Drive, memberCount: events.length, events };
  });
}

export async function createSeries(name: string, drive: Drive): Promise<string> {
  const id = newId("ser");
  const extras = { campaign: { ...emptyCampaign(), drive } };
  const { error } = await supabase.from("event_series").insert({ id, name: name.trim() || "Untitled campaign", extras });
  if (error) throw error;
  return id;
}

// Member events of a series (non-template). Split out so callers can refetch just the events
// without re-reading the campaign jsonb (which would clobber an optimistic in-flight campaign save).
export async function getSeriesEvents(seriesId: string): Promise<SeriesEvent[]> {
  const { data: evs, error } = await supabase.from("event").select("id, name, event_date, location, event_budget_target, start_time, end_time").eq("series_id", seriesId).eq("is_template", false);
  if (error) throw error;
  return (evs ?? []).map((e: any) => ({ id: e.id, name: e.name, date: e.event_date ?? null, location: e.location ?? null, eventBudgetTarget: e.event_budget_target ?? null, startTime: e.start_time ?? null, endTime: e.end_time ?? null }));
}

export interface SeriesCommitted { eventId: string; name: string; currency: string; committed: number; }
// Per member event: the sum of its COMMITTED budget lines (payment_status not 'estimate') + that
// event's budget currency. A read for the Budget tab's Paid block — the series never commits money.
export async function getSeriesCommittedTotals(seriesId: string): Promise<SeriesCommitted[]> {
  const { data: evs, error } = await supabase.from("event").select("id, name").eq("series_id", seriesId).eq("is_template", false);
  if (error) throw error;
  const events = (evs ?? []) as { id: string; name: string }[];
  if (!events.length) return [];
  const ids = events.map((e) => e.id);
  const { data: budgets, error: bErr } = await supabase.from("budget").select("event_id, currency, lines:budget_line ( confirmed_amount, payment_status )").in("event_id", ids);
  if (bErr) throw bErr;
  const byEvent = new Map<string, { currency: string; committed: number }>();
  for (const b of (budgets ?? []) as any[]) {
    const cur = byEvent.get(b.event_id) ?? { currency: b.currency ?? "USD", committed: 0 };
    for (const l of b.lines ?? []) {
      if (normBudgetStatus(l.payment_status) !== "estimate") cur.committed += Number(l.confirmed_amount) || 0;
    }
    byEvent.set(b.event_id, cur);
  }
  return events.map((e) => ({ eventId: e.id, name: e.name, currency: byEvent.get(e.id)?.currency ?? "USD", committed: byEvent.get(e.id)?.committed ?? 0 }));
}

export async function getSeriesCampaign(seriesId: string): Promise<{ id: string; name: string; campaign: Campaign; events: SeriesEvent[] }> {
  const { data: s, error } = await supabase.from("event_series").select("id, name, extras").eq("id", seriesId).single();
  if (error) throw error;
  const events = await getSeriesEvents(seriesId);
  return { id: s.id, name: s.name, campaign: normalizeCampaign((s as any).extras?.campaign), events };
}

// Rename a series (the campaign title). Falls back to a placeholder if cleared.
export async function renameSeries(seriesId: string, name: string): Promise<void> {
  const { error } = await supabase.from("event_series").update({ name: name.trim() || "Untitled campaign" }).eq("id", seriesId);
  if (error) throw error;
}

// Read-modify-write of extras.campaign (preserve any other extras keys).
export async function saveCampaign(seriesId: string, campaign: Campaign): Promise<void> {
  const { data: s, error: readErr } = await supabase.from("event_series").select("extras").eq("id", seriesId).single();
  if (readErr) throw readErr;
  const extras = { ...((s as any).extras ?? {}), campaign };
  const { error } = await supabase.from("event_series").update({ extras }).eq("id", seriesId);
  if (error) throw error;
}

export async function setEventSeries(eventId: string, seriesId: string | null): Promise<void> {
  const { error } = await supabase.from("event").update({ series_id: seriesId }).eq("id", eventId);
  if (error) throw error;
}

// ── Consolidated budget (across all events) ─────────────────────────────────
export interface EventBudgetRollup {
  eventId: string;
  name: string;
  status: EventStatus;
  date: string | null;
  tags: string[];          // for bucketing (external/internal)
  format: string | null;   // for bucketing (e.g. happy hour)
  estimate: number; // full estimated cost — sum of every budget line
  paid: number;     // actual amount paid — sum of lines marked paid
}
export interface ConsolidatedBudget {
  rows: EventBudgetRollup[];
  totalEstimate: number;
  totalPaid: number;
  target: number;   // period-level spend target across all events
  currency: string;
}

/** Roll each event's budget into one row: full estimate (sum of all lines) and actual
 *  paid (sum of lines marked paid). Only events with budget activity are included. */
export async function getConsolidatedBudget(): Promise<ConsolidatedBudget> {
  const TARGET = 250_000;
  const events = await listEvents();
  const { data, error } = await supabase
    .from('budget')
    .select('event_id, lines:budget_line ( confirmed_amount, payment_status )');
  if (error) throw error;

  // event_id → rolled totals (an event may, defensively, have more than one budget row).
  const byEvent = new Map<string, { estimate: number; paid: number }>();
  for (const b of (data ?? []) as any[]) {
    const cur = byEvent.get(b.event_id) ?? { estimate: 0, paid: 0 };
    for (const l of b.lines ?? []) {
      const amt = l.confirmed_amount ?? 0;
      cur.estimate += amt;
      if (normBudgetStatus(l.payment_status) === 'paid') cur.paid += amt;
    }
    byEvent.set(b.event_id, cur);
  }

  // Relevant events only: active (in-process), past within the last month, and future
  // events that have money attached. Events with budget activity sort to the top.
  const monthAgo = new Date();
  monthAgo.setMonth(monthAgo.getMonth() - 1);
  const monthAgoStr = monthAgo.toISOString().slice(0, 10);
  const rows: EventBudgetRollup[] = events
    .filter((e) => !e.isTemplate) // templates are reusable types, not budgeted events
    .map((e) => {
      const t = byEvent.get(e.id) ?? { estimate: 0, paid: 0 };
      return { eventId: e.id, name: e.title, status: e.status, date: e.date, tags: e.tags, format: e.format, estimate: t.estimate, paid: t.paid };
    })
    .filter((r) => {
      if (r.status === 'in-process') return true;                          // active
      if (r.status === 'past') return r.date != null && r.date >= monthAgoStr; // recent past
      return r.estimate > 0 || r.paid > 0;                                 // future, only if budgeted
    })
    .sort((a, b) => b.estimate - a.estimate);

  return {
    rows,
    totalEstimate: rows.reduce((s, r) => s + r.estimate, 0),
    totalPaid: rows.reduce((s, r) => s + r.paid, 0),
    target: TARGET,
    currency: 'USD',
  };
}

export async function getEventDetail(id: string): Promise<EventDetail | null> {
  const { data: row, error } = await supabase
    .from('event')
    .select(
      'id, name, tag, tags, description, format, location, office, event_date, start_time, end_time, rsvp, capacity, checked_in, waitlist_admitted, actual_attendance_note, audience, notes, source_materials, macro_stage, owning_team, status, owners:event_owner ( profile:profile ( id, name, color ) ), series_id, cover_image_url, luma_cover_url, custom_cover_url, cover_position, ' +
        'event_label ( label_id ), series:event_series ( id, name, type, status, owning_team, verdict )',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;

  const series: SeriesJoin = (row as any).series ?? null;
  const seriesId = series?.id ?? (row as any).series_id ?? null;

  // Attendees on this event (join carries the role).
  const { data: links } = await supabase
    .from('attendee_event')
    .select('role_at_event, attendee:attendee ( id, name, type, org, title, is_aggregate, count_est, note )')
    .eq('event_id', id);

  const attendees: AttendeeView[] = (links ?? []).map((l: any) => ({
    id: l.attendee?.id,
    name: l.attendee?.name ?? null,
    type: l.attendee?.type ?? null,
    org: l.attendee?.org ?? null,
    title: l.attendee?.title ?? null,
    role: l.role_at_event ?? 'attendee',
    isAggregate: l.attendee?.is_aggregate ?? false,
    countEst: l.attendee?.count_est ?? null,
    note: l.attendee?.note ?? null,
  }));
  const speakers: Speaker[] = attendees
    .filter((a) => a.role === 'speaker')
    .map((a) => ({ id: a.id, name: a.name, title: a.title, org: a.org }));

  // Series-level extras: reflections, engagements (+vendor), budget.
  let reflections: Reflection[] = [];
  let engagements: EngagementView[] = [];
  let budget: BudgetView | null = null;

  if (seriesId) {
    const [{ data: refs }, { data: engs }, { data: budgets }] = await Promise.all([
      supabase.from('reflection').select('id, body').eq('series_id', seriesId).order('id'),
      supabase
        .from('engagement')
        .select('id, category, stage, confirmed_amount, note, vendor:vendor ( name )')
        .eq('series_id', seriesId)
        .order('id'),
      supabase
        .from('budget')
        .select('id, currency, reported_total, lines:budget_line ( id, label, confirmed_amount, linked_engagement, is_uncategorized, note )')
        .eq('series_id', seriesId),
    ]);

    reflections = (refs ?? []).map((r: any) => ({ id: r.id, body: r.body }));
    engagements = (engs ?? []).map((e: any) => ({
      id: e.id,
      category: e.category,
      vendorName: e.vendor?.name ?? null,
      stage: e.stage,
      confirmedAmount: e.confirmed_amount,
      note: e.note,
    }));

    const b: any = (budgets ?? [])[0];
    if (b) {
      const lines: BudgetLineView[] = (b.lines ?? []).map((l: any) => ({
        id: l.id,
        label: l.label,
        confirmedAmount: l.confirmed_amount,
        linkedEngagement: l.linked_engagement,
        isUncategorized: l.is_uncategorized ?? false,
        note: l.note,
      }));
      const lineSum = lines.reduce((s, l) => s + (l.confirmedAmount ?? 0), 0);
      const reportedTotal = b.reported_total ?? null;
      budget = {
        id: b.id,
        currency: b.currency ?? 'USD',
        reportedTotal,
        lineSum,
        discrepancy: reportedTotal == null ? 0 : reportedTotal - lineSum,
        lines,
      };
    }
  }

  const sourceMaterials: SourceMaterial[] = Array.isArray((row as any).source_materials) ? (row as any).source_materials as SourceMaterial[] : [];
  const sm = await signDocValues(sourceMaterials.map((m) => m.url));
  for (const m of sourceMaterials) { const s = sm.get(m.url); if (s) m.url = s; }

  return {
    ...toListItem(row),
    description: (row as any).description ?? null,
    audience: (row as any).audience ?? null,
    actualAttendanceNote: (row as any).actual_attendance_note ?? null,
    checkedIn: (row as any).checked_in ?? null,
    waitlistAdmitted: (row as any).waitlist_admitted ?? null,
    notes: (row as any).notes ?? [],
    sourceMaterials,
    speakers,
    attendees,
    reflections,
    engagements,
    budget,
    seriesStatus: series?.status ?? null,
    seriesVerdict: series?.verdict ?? null,
  };
}

// ── Label exports (CSV-ready rows) ──────────────────────────────────────────
async function eventIdsInLabel(labelId: string): Promise<string[]> {
  const { data, error } = await supabase.from('event_label').select('event_id').eq('label_id', labelId);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.event_id);
}

/** One row per event in an events label (live counts). */
export async function exportEventsSummary(labelId: string): Promise<Record<string, unknown>[]> {
  const ids = await eventIdsInLabel(labelId);
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('event')
    .select('id, name, tag, event_date, location, office')
    .in('id', ids);
  if (error) throw error;

  // One query for ALL attendee links across every event (avoids the N+1 of a per-event
  // getEventPeopleStats call), then aggregate per event in JS with the shared tallyStats.
  const { data: links, error: linkErr } = await supabase
    .from('attendee_event')
    .select('event_id, registration_status, checked_in')
    .in('event_id', ids);
  if (linkErr) throw linkErr;

  const byEvent = new Map<string, { registrationStatus: string | null; checkedIn: boolean }[]>();
  for (const r of links ?? []) {
    const arr = byEvent.get((r as any).event_id) ?? [];
    arr.push({ registrationStatus: (r as any).registration_status, checkedIn: (r as any).checked_in });
    byEvent.set((r as any).event_id, arr);
  }

  return (data ?? []).map((e: any) => {
    const s = tallyStats(byEvent.get(e.id) ?? []);
    return {
      event: e.name,
      tag: e.tag ?? '',
      date: e.event_date ?? '',
      location: e.location ?? e.office ?? '',
      registered: s.registered,
      checked_in: s.checkedIn,
      total: s.total,
    };
  });
}

/** One row per attendee across an events label, deduped by person. */
export async function exportEventsAttendees(labelId: string): Promise<Record<string, unknown>[]> {
  const ids = await eventIdsInLabel(labelId);
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('attendee_event')
    .select('checked_in, registration_status, event:event ( name ), attendee:attendee ( id, name, email, type, org, title )')
    .in('event_id', ids);
  if (error) throw error;
  const byPerson = new Map<string, any>();
  for (const l of data ?? []) {
    const a = (l as any).attendee;
    if (!a) continue;
    const cur = byPerson.get(a.id) ?? {
      name: a.name ?? '', email: a.email ?? '', type: a.type ?? '', org: a.org ?? '', title: a.title ?? '',
      events_attended: [] as string[], checked_in: false,
    };
    if ((l as any).event?.name) cur.events_attended.push((l as any).event.name);
    if ((l as any).checked_in) cur.checked_in = true;
    byPerson.set(a.id, cur);
  }
  return [...byPerson.values()].map((r) => ({ ...r, events_attended: r.events_attended.join('; ') }));
}

/** One row per person in a people label. */
export async function exportPeople(labelId: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase
    .from('attendee_label')
    .select('attendee:attendee ( name, email, type, org, title, school, city, industry, note )')
    .eq('label_id', labelId);
  if (error) throw error;
  return (data ?? []).map((l: any) => {
    const a = l.attendee ?? {};
    return {
      name: a.name ?? '', email: a.email ?? '', type: a.type ?? '', org: a.org ?? '',
      title: a.title ?? '', school: a.school ?? '', city: a.city ?? '', industry: a.industry ?? '', note: a.note ?? '',
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Planning View (in-process). Engagements/budget/deliverables here attach at
// the EVENT level (vs the recap page, which reads series-level rollups).
// ─────────────────────────────────────────────────────────────────────────────

export const MACRO_STAGES = ['Concept', 'Planning', 'Week-of', 'Live', 'Wrap'] as const;
// Simplified pipeline: you're either still deciding (Sourced) or you've committed (Contracted).
// Old rows with Quoted/Selected/Negotiating read as Sourced (see coerceStage); stage is free text
// so no migration is needed.
export const ENGAGEMENT_STAGES = ['Sourced', 'Contracted'] as const;
export function coerceStage(s: string | null | undefined): (typeof ENGAGEMENT_STAGES)[number] {
  return s === 'Contracted' ? 'Contracted' : 'Sourced';
}
export type EngagementStage = (typeof ENGAGEMENT_STAGES)[number];

const genId = (prefix: string) => `${prefix}-` + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
const num = (n: unknown): number | null => (n == null || n === '' ? null : Number(n));

export interface VendorCandidate {
  id: string;
  vendorName: string | null;
  quoteAmount: number | null;
  isSelected: boolean;
  note: string | null;
  link: string | null;
}
export interface EngagementWithCandidates {
  id: string;
  category: string | null;
  stage: string | null;
  confirmedAmount: number | null;
  note: string | null;
  candidates: VendorCandidate[];
  outreachStarted: boolean; // setup walkthrough: outreach kicked off for this category
  watchInbox: boolean;      // setup walkthrough: opted in to inbox auto-log (V2 Gmail sync)
}
// Budget line lifecycle stage (replaces the old pending/committed/paid model).
// The budget status ladder: estimate (a figure we're guessing) → quoted (a confirmed number) →
// paid (actually paid out). No 'in_review' — legacy committed/pending/in_review fold into 'quoted'.
export const BUDGET_STATUSES = ['estimate', 'quoted', 'paid'] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];
/** Map any stored value (incl. legacy 'pending'/'committed'/'in_review'/null) to a current status. */
export function normBudgetStatus(s: any): BudgetStatus {
  if (s === 'paid' || s === 'quoted' || s === 'estimate') return s;
  if (s === 'in_review' || s === 'pending' || s === 'committed') return 'quoted'; // legacy → confirmed number
  return 'estimate';
}
const BUDGET_RANK: Record<BudgetStatus, number> = { estimate: 0, quoted: 1, paid: 2 };
export interface BudgetLineTracker {
  id: string;
  label: string | null;
  confirmedAmount: number | null;
  target: number | null;    // optional per-category budget target (vs the projected estimate)
  status: BudgetStatus;
  syncUrl: string | null;   // web address (vendor portal / quote thread) for email-synced updates
  docUrl: string | null;
  note: string | null;      // free-text update / comment ("venue sent contract, waiting on…")
  linkedEngagement: string | null;
}
export interface PlanningBudget {
  id: string;
  currency: string;
  targetAmount: number | null;
  lines: BudgetLineTracker[];
}
export interface ReferenceLink {
  id: string;
  label: string;
  url: string;
  kind?: "folder" | "link";
}
export interface Deliverable {
  id: string;
  title: string;
  phase: string | null;
  ownerRole: string | null;
  dueDate: string | null;
  offsetStart: number | null; // days from event date (negative = before)
  offsetEnd: number | null;   // optional range end
  status: string | null;
  linearIssueId: string | null;
  linearIssueUrl: string | null; // deep link to the Linear issue, once synced
  locked: boolean;            // non-deletable (e.g. the mandatory post-mortem)
}
export interface EventPhase { name: string; order: number }
export interface RunOfShowItem { time: string; title: string }
export interface CarriedLesson {
  body: string;
  sourceEventName: string;
  sourceEventId: string | null; // the event this learning came from (clickable), if known
  why: string;
}
export interface EventPlanning {
  id: string;
  title: string;
  tags: string[];
  format: string | null;
  focusOverride: EventFocus | null; // manual focus correction; null = auto (keyword classifier)
  location: string | null;
  description: string | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  phases: EventPhase[];
  planningLeadTime: string | null;
  agenda: RunOfShowItem[];
  staffRoles: string[];
  reflections: string[];
  walkthrough: WalkStep[];
  heuristics: string[];
  outreach: OutreachTemplate[];
  sourceMaterials: SourceMaterial[];
  referenceLinks: ReferenceLink[];
  docLink: string | null;   // single prominent Drive/Doc link in the header (distinct from referenceLinks)
  slackChannel: string | null; // linked Slack channel id ⇒ :eventhub: pins route here
  isTemplate: boolean;
  capacity: number | null;
  rsvp: number | null;
  checkedIn: number | null; // event-level counted heads (a stat, distinct from identified records)
  owner: string | null;
  owners: { id: string; name: string; color: string | null }[];
  macroStage: string | null;
  status: EventStatus;
  // Wrap & write-back (v1): settling lifecycle + recorded outcome + persisted debrief notes.
  settleState: 'just_wrapped' | 'debriefed' | 'settled' | null;
  settledAt: string | null;
  verdict: string | null;
  debriefNotes: string | null;
  roleAssignments: Record<string, string>; // staff role → person who filled it (resolved at settle)
  modeledOnEventId: string | null; // the template/source this event was spun up from
  overviewSummary: string | null;
  lumaUrl: string | null;
  lumaEventId: string | null;
  gcalEventId: string | null;
  gcalHtmlLink: string | null;
  gcalEventIds: Record<string, string>;
  gcalMatchPending: Record<string, { gcalEventId: string; summary: string; start: string; htmlLink: string; reason?: string } | null> | null;
  linearProjectId: string | null;
  linearProjectUrl: string | null;
  coverImageUrl: string | null;
  lumaCoverUrl: string | null;
  customCoverUrl: string | null;
  coverPosition: string | null; // CSS object-position ("x% y%") for cropping on cards
  page: PageState;
  pageDraft: PageDraft | null;
  engagements: EngagementWithCandidates[];
  budget: PlanningBudget | null;
  deliverables: Deliverable[];
  // Setup walkthrough state.
  setupComplete: boolean;
  headcount: number | null;
  eventBudgetTarget: number | null;
  setupProgress: string[]; // completed step keys
}

export type PageOwnership = 'generated' | 'dev-owned';
export interface PageState {
  ownership: PageOwnership;
  repoRef: string | null;
  lastDeployStatus: string | null;
  previewUrl: string | null;
  liveUrl: string | null;
  ejectedAt: string | null;
  ejectedSnapshot: Record<string, unknown> | null;
}
export interface Developer { id: string; email: string; createdAt: string; }

// No-code page builder draft (editable content only; factual fields + the speaker
// list stay data-bound). Section order/visibility + theme are user-controlled.
export type PageFont = 'inter' | 'serif' | 'grotesk';
export type AgendaLayout = 'list' | 'timeline' | 'cards';
export interface AgendaItem { time: string; title: string; desc: string }
export interface PageTheme {
  headingFont: PageFont;          // font for section titles / hero
  bodyFont: PageFont;             // font for body copy
  accent: string;
  accentOn: 'marker' | 'title';   // where the accent color lands on a section heading
  headingStyle: 'plain' | 'marker'; // 'marker' = small square + uppercase tracked label
  bgImageUrl: string | null;
  bgColor: string | null;
  textColor: string | null;       // overrides the default body/heading text color
  scrollAnim: boolean;
}
export interface PageDraft {
  theme: PageTheme;
  headingFonts: Record<string, PageFont>; // per-section heading-font override (key = section key)
  hero: { headline: string; subhead: string; coverUrl: string | null };
  about: { title: string; body: string };
  agenda: { title: string; items: AgendaItem[]; layout: AgendaLayout };
  speakers: { title: string; cardStyle: 'circle' | 'card' }; // list is data-bound (listEventSpeakers)
  details: { title: string; rsvpLabel: string };
  gallery: { title: string; images: string[] };
  logos: { images: string[] };
  closing: { headline: string; body: string; rsvpLabel: string };
  order: string[];                 // body-section order (hero is fixed on top)
  visible: Record<string, boolean>;
}
export function defaultPageDraft(): PageDraft {
  return {
    theme: { headingFont: 'inter', bodyFont: 'inter', accent: '#111827', accentOn: 'marker', headingStyle: 'plain', bgImageUrl: null, bgColor: null, textColor: null, scrollAnim: true },
    headingFonts: {},
    hero: { headline: '', subhead: '', coverUrl: null },
    about: { title: 'About', body: '' },
    agenda: { title: 'Agenda', items: [], layout: 'list' },
    speakers: { title: 'Speakers', cardStyle: 'circle' },
    details: { title: 'Details', rsvpLabel: 'RSVP' },
    gallery: { title: 'Gallery', images: [] },
    logos: { images: [] },
    closing: { headline: 'Seats are limited.', body: 'Reserve your spot today.', rsvpLabel: 'RSVP' },
    order: ['about', 'agenda', 'speakers', 'details', 'gallery', 'logos', 'closing'],
    visible: { hero: true, about: true, agenda: false, speakers: false, details: true, gallery: false, logos: false, closing: false },
  };
}

function mapCandidate(c: any): VendorCandidate {
  return {
    id: c.id,
    vendorName: c.vendor?.name ?? c.vendor_name ?? null,
    quoteAmount: num(c.quote_amount),
    isSelected: c.is_selected ?? false,
    note: c.note ?? null,
    link: c.link ?? null,
  };
}

export async function getEventPlanning(eventId: string): Promise<EventPlanning | null> {
  const { data: row, error } = await supabase
    .from('event')
    .select('id, name, tags, format, focus_override, location, office, description, event_date, start_time, end_time, phases, planning_lead_time, agenda, staff_roles, reflections, walkthrough, heuristics, outreach, source_materials, reference_links, doc_link, slack_channel, is_template, capacity, rsvp, checked_in, headcount, macro_stage, owning_team, status, setup_complete, event_budget_target, setup_progress, settle_state, settled_at, verdict, debrief_notes, role_assignments, modeled_on_event_id, owners:event_owner ( profile:profile ( id, name, color ) ), overview_summary, luma_url, luma_event_id, page_ownership, repo_ref, last_deploy_status, preview_url, live_url, ejected_at, ejected_snapshot, page_draft, cover_image_url, luma_cover_url, custom_cover_url, cover_position, gcal_event_id, gcal_html_link, gcal_event_ids, gcal_match_pending, linear_project_id, linear_project_url, series:event_series ( owning_team, status )')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;

  const [{ data: engs }, { data: budgets }, { data: dels }] = await Promise.all([
    supabase
      .from('engagement')
      .select('id, category, stage, confirmed_amount, note, outreach_started, watch_inbox, candidates:engagement_candidate ( id, vendor_id, vendor_name, quote_amount, is_selected, note, link, vendor:vendor ( name ) )')
      .eq('event_id', eventId)
      .order('id'),
    supabase
      .from('budget')
      .select('id, currency, target_amount, lines:budget_line ( id, label, confirmed_amount, target, payment_status, sync_url, doc_url, note, linked_engagement )')
      .eq('event_id', eventId),
    supabase
      .from('deliverable')
      .select('id, title, phase, owner_role, resolved_due_date, offset_start, offset_end, status, linear_issue_id, linear_issue_url, locked')
      .eq('event_id', eventId)
      .order('resolved_due_date', { nullsFirst: true }),
  ]);

  const engagements: EngagementWithCandidates[] = (engs ?? []).map((e: any) => ({
    id: e.id,
    category: e.category,
    stage: e.stage,
    confirmedAmount: num(e.confirmed_amount),
    note: e.note,
    candidates: (e.candidates ?? []).map(mapCandidate),
    outreachStarted: e.outreach_started ?? false,
    watchInbox: e.watch_inbox ?? false,
  }));

  const b: any = (budgets ?? [])[0];
  const budget: PlanningBudget | null = b
    ? {
        id: b.id,
        currency: b.currency ?? 'USD',
        targetAmount: num(b.target_amount),
        lines: (b.lines ?? []).map((l: any) => ({
          id: l.id,
          label: l.label,
          confirmedAmount: num(l.confirmed_amount),
          target: num(l.target),
          status: normBudgetStatus(l.payment_status),
          syncUrl: l.sync_url ?? null,
          docUrl: l.doc_url ?? null,
          note: l.note ?? null,
          linkedEngagement: l.linked_engagement ?? null,
        })),
      }
    : null;

  const deliverables: Deliverable[] = (dels ?? []).map((d: any) => ({
    id: d.id,
    title: d.title,
    phase: d.phase ?? null,
    ownerRole: d.owner_role ?? null,
    dueDate: d.resolved_due_date ?? null,
    offsetStart: d.offset_start ?? null,
    offsetEnd: d.offset_end ?? null,
    status: d.status ?? null,
    linearIssueId: d.linear_issue_id ?? null,
    linearIssueUrl: d.linear_issue_url ?? null,
    locked: d.locked ?? false,
  }));

  // Sensitive docs (source materials + budget provenance) live in the private bucket as paths —
  // resolve them to short-lived signed URLs for display. Legacy public/external URLs pass through.
  const sourceMaterials: SourceMaterial[] = Array.isArray((row as any).source_materials) ? (row as any).source_materials as SourceMaterial[] : [];
  const signMap = await signDocValues([...sourceMaterials.map((m) => m.url), ...(budget?.lines ?? []).map((l) => l.docUrl)]);
  for (const m of sourceMaterials) { const s = signMap.get(m.url); if (s) m.url = s; }
  if (budget) for (const l of budget.lines) { if (l.docUrl) { const s = signMap.get(l.docUrl); if (s) l.docUrl = s; } }

  return {
    id: row.id,
    title: (row as any).name,
    tags: (row as any).tags ?? [],
    format: (row as any).format ?? null,
    focusOverride: ((row as any).focus_override ?? null) as EventFocus | null,
    location: (row as any).location ?? (row as any).office ?? null,
    description: (row as any).description ?? null,
    // Luma-imported (and other) events can land with NO phases; fall back to the same date-aware
    // defaults platform/backfilled events get, so the beginning page renders the normal timeline.
    phases: (() => {
      const p = Array.isArray((row as any).phases) ? (row as any).phases as EventPhase[] : [];
      return (p.length || (row as any).is_template) ? p : defaultPhases((row as any).event_date ?? null);
    })(),
    planningLeadTime: (row as any).planning_lead_time ?? null,
    agenda: Array.isArray((row as any).agenda) ? (row as any).agenda as RunOfShowItem[] : [],
    staffRoles: Array.isArray((row as any).staff_roles) ? (row as any).staff_roles as string[] : [],
    reflections: Array.isArray((row as any).reflections) ? (row as any).reflections as string[] : [],
    walkthrough: Array.isArray((row as any).walkthrough) ? (row as any).walkthrough as WalkStep[] : [],
    heuristics: Array.isArray((row as any).heuristics) ? (row as any).heuristics as string[] : [],
    outreach: Array.isArray((row as any).outreach) ? (row as any).outreach as OutreachTemplate[] : [],
    sourceMaterials,
    referenceLinks: Array.isArray((row as any).reference_links) ? (row as any).reference_links : [],
    docLink: (row as any).doc_link ?? null,
    slackChannel: (row as any).slack_channel ?? null,
    isTemplate: (row as any).is_template ?? false,
    startTime: (row as any).start_time ?? null,
    endTime: (row as any).end_time ?? null,
    date: (row as any).event_date ?? null,
    capacity: (row as any).capacity ?? null,
    rsvp: (row as any).rsvp ?? null,
    checkedIn: (row as any).checked_in ?? null,
    ...ownersOf(row),
    // A set macro_stage routes to the active-planning view; Luma-imported events arrive null, which
    // renders an unplanned-looking page. Default non-template events to Planning for parity.
    macroStage: (row as any).macro_stage ?? ((row as any).is_template ? null : 'Planning'),
    status: resolveStatus(row, (row as any).series ?? null),
    settleState: (row as any).settle_state ?? null,
    settledAt: (row as any).settled_at ?? null,
    verdict: (row as any).verdict ?? null,
    debriefNotes: (row as any).debrief_notes ?? null,
    roleAssignments: ((row as any).role_assignments ?? {}) as Record<string, string>,
    modeledOnEventId: (row as any).modeled_on_event_id ?? null,
    overviewSummary: (row as any).overview_summary ?? null,
    lumaUrl: (row as any).luma_url ?? null,
    lumaEventId: (row as any).luma_event_id ?? null,
    gcalEventId: (row as any).gcal_event_id ?? null,
    gcalHtmlLink: (row as any).gcal_html_link ?? null,
    gcalEventIds: (row as any).gcal_event_ids ?? {},
    gcalMatchPending: (row as any).gcal_match_pending ?? null,
    linearProjectId: (row as any).linear_project_id ?? null,
    linearProjectUrl: (row as any).linear_project_url ?? null,
    coverImageUrl: (row as any).cover_image_url ?? null,
    lumaCoverUrl: (row as any).luma_cover_url ?? null,
    customCoverUrl: (row as any).custom_cover_url ?? null,
    coverPosition: (row as any).cover_position ?? null,
    page: {
      ownership: ((row as any).page_ownership ?? 'generated') as PageOwnership,
      repoRef: (row as any).repo_ref ?? null,
      lastDeployStatus: (row as any).last_deploy_status ?? null,
      previewUrl: (row as any).preview_url ?? null,
      liveUrl: (row as any).live_url ?? null,
      ejectedAt: (row as any).ejected_at ?? null,
      ejectedSnapshot: (row as any).ejected_snapshot ?? null,
    },
    pageDraft: ((row as any).page_draft ?? null) as PageDraft | null,
    engagements,
    budget,
    deliverables,
    setupComplete: (row as any).setup_complete ?? false,
    headcount: (row as any).headcount ?? null,
    eventBudgetTarget: num((row as any).event_budget_target),
    setupProgress: Array.isArray((row as any).setup_progress) ? (row as any).setup_progress as string[] : [],
  };
}

// ── Templates → spin up a concrete event ─────────────────────────────────────
export interface TemplateChild { id: string; name: string; date: string | null; turnout: number | null }
/** Events spun up from a template (modeled_on_event_id === templateId). Read-only links;
 *  their actuals refine the template's show-rate + budget ranges over time. */
export async function eventsFromTemplate(templateId: string): Promise<TemplateChild[]> {
  const { data, error } = await supabase
    .from('event')
    .select('id, name, event_date, checked_in, rsvp')
    .eq('modeled_on_event_id', templateId)
    .order('event_date', { nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map((e: any) => ({ id: e.id, name: e.name, date: e.event_date ?? null, turnout: e.checked_in ?? e.rsvp ?? null }));
}

/** Spin up a live event from a template: COPIES everything (no back-reference that would
 *  propagate future template edits), resolves every deliverable offset to a real date from
 *  the chosen date, and records modeled_on_event_id for the "events from this template" list. */
export async function spinUpFromTemplate(templateId: string, opts: { name: string; date: string | null; location: string | null; tags?: string[] }): Promise<string> {
  const t = await getEventPlanning(templateId);
  if (!t) throw new Error('Template not found');
  const newId = await createPlanningEvent({
    name: opts.name, date: opts.date, location: opts.location,
    startTime: t.startTime, endTime: t.endTime, tags: opts.tags && opts.tags.length ? opts.tags : t.tags, format: t.format,
    phases: t.phases, planningLeadTime: t.planningLeadTime,
    agenda: t.agenda, staffRoles: t.staffRoles, reflections: t.reflections,
    walkthrough: t.walkthrough, heuristics: t.heuristics, outreach: t.outreach,
    template: { name: opts.name, vendorCategories: t.engagements.map((e) => e.category).filter((c): c is string => !!c), budgetLines: [], progressCategories: [] },
    isTemplate: false, modeledOnEventId: templateId,
  });
  // Copy deliverables, resolving offsets → due dates against the chosen date. Skip the
  // template's locked post-mortem — createPlanningEvent already added a fresh one.
  const base = opts.date ? new Date(opts.date + 'T00:00:00') : null;
  for (const d of t.deliverables) {
    if (d.locked) continue;
    let due: string | null = null;
    if (base && d.offsetStart != null) { const dt = new Date(base); dt.setDate(dt.getDate() + d.offsetStart); due = dt.toISOString().slice(0, 10); }
    try { await addDeliverable(newId, { title: d.title, phase: d.phase ?? 'Planning', ownerRole: d.ownerRole, dueDate: due, offsetStart: d.offsetStart, offsetEnd: d.offsetEnd }); } catch { /* non-fatal */ }
  }
  // Copy any budget lines the template carried.
  if (t.budget?.lines.length) {
    try { const np = await getEventPlanning(newId); if (np?.budget) await addBudgetLines(np.budget.id, t.budget.lines.filter((l) => l.label).map((l) => ({ label: l.label as string, amount: l.confirmedAmount ?? l.target }))); } catch { /* non-fatal */ }
  }
  return newId;
}

// ── Macro stage ─────────────────────────────────────────────────────────────
export async function setMacroStage(eventId: string, stage: string): Promise<void> {
  const { error } = await supabase.from('event').update({ macro_stage: stage }).eq('id', eventId);
  if (error) throw error;
}

// ── Engagements (vendor decisions) ──────────────────────────────────────────
export async function addEngagement(eventId: string, category: string, estimate: number | null = null): Promise<EngagementWithCandidates> {
  const id = genId('eng');
  const { error } = await supabase.from('engagement').insert({ id, event_id: eventId, category, stage: 'Sourced' });
  if (error) throw error;
  await graduateFromConcept(eventId);
  // A vendor decision is a cost → mirror it as a linked budget line so it shows on the Budget page.
  try {
    const { data: b } = await supabase.from('budget').select('id').eq('event_id', eventId).maybeSingle();
    if (b) await supabase.from('budget_line').insert({ id: genId('bl'), budget_id: (b as any).id, label: category, confirmed_amount: estimate, linked_engagement: id });
  } catch { /* non-fatal — the decision still exists */ }
  return { id, category, stage: 'Sourced', confirmedAmount: null, note: null, candidates: [], outreachStarted: false, watchInbox: false };
}
export async function deleteEngagement(id: string): Promise<void> {
  const { error } = await supabase.from('engagement').delete().eq('id', id);
  if (error) throw error;
}
/** Advance/set a decision's stage. Pass confirmedAmount when locking (→ Contracted);
 *  note/docUrl capture the comment/attachment prompted on Selected/Contracted. */
export async function setEngagementStage(
  id: string,
  stage: string,
  opts?: { confirmedAmount?: number | null; note?: string | null; docUrl?: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = { stage };
  if (opts && 'confirmedAmount' in opts) patch.confirmed_amount = opts.confirmedAmount;
  if (opts && 'note' in opts) patch.note = opts.note;
  if (opts && 'docUrl' in opts) patch.doc_url = opts.docUrl;
  const { error } = await supabase.from('engagement').update(patch).eq('id', id);
  if (error) throw error;
}

// ── Vendor directory identity ───────────────────────────────────────────────
// Adding a vendor anywhere should surface it in the persistent directory (Vendors page). We match
// names case-insensitively, ignoring punctuation/spacing: an exact match is reused silently; a
// partial ("near") match is returned so the UI can ask before creating a possible duplicate.
const normVendor = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
export interface VendorMatch { exact: VendorRow | null; near: VendorRow[]; }
export async function matchVendors(name: string): Promise<VendorMatch> {
  const n = normVendor(name);
  if (!n) return { exact: null, near: [] };
  const all = await listVendors();
  let exact: VendorRow | null = null;
  const near: VendorRow[] = [];
  for (const v of all) {
    if (!v.name) continue;
    const vn = normVendor(v.name);
    if (!vn) continue;
    if (vn === n) exact = v;
    else if (vn.includes(n) || n.includes(vn)) near.push(v);
  }
  return { exact, near };
}
/** Reuse the exact-name directory vendor or create a new one; returns the vendor id. */
export async function ensureVendor(name: string, category: string | null): Promise<string> {
  const { exact } = await matchVendors(name);
  if (exact) return exact.id;
  const id = genId('vend');
  const { error } = await supabase.from('vendor').insert({ id, name: name.trim(), category: category ?? null });
  if (error) throw error;
  return id;
}

// Events / series a vendor has been engaged on — for the directory's "used at" detail.
export interface VendorUsage {
  engagementId: string; category: string | null; stage: string | null; contracted: boolean;
  eventId: string | null; eventName: string | null; date: string | null; seriesName: string | null;
}
export async function getVendorUsage(vendorId: string): Promise<VendorUsage[]> {
  const { data, error } = await supabase
    .from('engagement_candidate')
    .select('engagement:engagement ( id, category, stage, event:event ( id, name, event_date ), series:event_series ( id, name ) )')
    .eq('vendor_id', vendorId);
  if (error) throw error;
  const seen = new Set<string>();
  const out: VendorUsage[] = [];
  for (const row of (data ?? []) as any[]) {
    const e = row.engagement;
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({
      engagementId: e.id, category: e.category ?? null, stage: e.stage ?? null, contracted: e.stage === 'Contracted',
      eventId: e.event?.id ?? null, eventName: e.event?.name ?? null, date: e.event?.event_date ?? null, seriesName: e.series?.name ?? null,
    });
  }
  return out;
}

/** On Contracted: append "Vendor: <name>" to the event's budget line for that category, creating
 *  the line (with the confirmed amount) when none matches. */
export async function noteVendorOnBudgetLine(eventId: string, category: string | null, vendorName: string, amount: number | null): Promise<void> {
  if (!category || !vendorName.trim()) return;
  const { data: bud } = await supabase.from('budget').select('id').eq('event_id', eventId).maybeSingle();
  if (!bud) return;
  const lines = await listBudgetLines((bud as any).id);
  const key = categoryKey(category);
  const match = lines.find((l) => l.label && categoryKey(l.label) === key);
  const tag = `Vendor: ${vendorName.trim()}`;
  if (match) {
    if (match.note && match.note.includes(tag)) return; // already noted
    await updateBudgetLine(match.id, { note: [match.note, tag].filter(Boolean).join(' · ') });
  } else {
    const line = await addTrackerLine((bud as any).id, category, amount);
    await updateBudgetLine(line.id, { note: tag });
  }
}

// ── Vendor candidates ───────────────────────────────────────────────────────
export async function addCandidate(engagementId: string, vendorName: string, quoteAmount: number | null, link: string, vendorId: string | null = null): Promise<VendorCandidate> {
  const id = genId('cand');
  const { error } = await supabase
    .from('engagement_candidate')
    .insert({ id, engagement_id: engagementId, vendor_name: vendorName, quote_amount: quoteAmount, link, vendor_id: vendorId });
  if (error) throw error;
  return { id, vendorName, quoteAmount, isSelected: false, note: null, link };
}
export async function updateCandidate(id: string, fields: { vendorName?: string | null; quoteAmount?: number | null; note?: string | null; link?: string | null }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if ('vendorName' in fields) patch.vendor_name = fields.vendorName;
  if ('quoteAmount' in fields) patch.quote_amount = fields.quoteAmount;
  if ('note' in fields) patch.note = fields.note;
  if ('link' in fields) patch.link = fields.link;
  const { error } = await supabase.from('engagement_candidate').update(patch).eq('id', id);
  if (error) throw error;
}
export async function deleteCandidate(id: string): Promise<void> {
  const { error } = await supabase.from('engagement_candidate').delete().eq('id', id);
  if (error) throw error;
}
/** Mark one candidate selected (clears the others on the same engagement). */
export async function selectCandidate(engagementId: string, candidateId: string): Promise<void> {
  const { error: e1 } = await supabase.from('engagement_candidate').update({ is_selected: false }).eq('engagement_id', engagementId);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from('engagement_candidate').update({ is_selected: true }).eq('id', candidateId);
  if (e2) throw e2;
}
/** Clear any selection on an engagement (unclick). */
export async function clearCandidateSelection(engagementId: string): Promise<void> {
  const { error } = await supabase.from('engagement_candidate').update({ is_selected: false }).eq('engagement_id', engagementId);
  if (error) throw error;
}

// Invoice line-items that are NOT vendors — taxes, fees, charges, sub/totals. A sheet where one
// supplier (ACE) provides many lines shouldn't turn "HST (13%)" into its own vendor.
const NON_VENDOR_ROW = /\b(hst|gst|pst|qst|vat|tax|hsc|cc\s*fee|credit[- ]?card|service charge|gratuity|tip|sub[- ]?total|grand\s*total|total|fees?)\b/i;

/** Import a parsed vendor list. VENDOR-CENTRIC: one supplier (e.g. ACE) that appears on several
 *  rows becomes ONE vendor, and its line categories TAG the matching existing budget lines
 *  (`linked_engagement`) — it never creates budget lines or changes their amount / paid status, so
 *  it can't inflate spend. Tax/fee/total rows are filtered out. Engagements are tagged with the
 *  source `docUrl` so removing that doc cascades them away. Idempotent (dedup by vendor name). */
export async function importVendors(eventId: string, rows: VendorListRow[], docUrl: string | null = null): Promise<{ vendors: number; tagged: number; skipped: number }> {
  const clean = rows.filter((r) => !NON_VENDOR_ROW.test(r.category ?? '') && !NON_VENDOR_ROW.test(r.vendor ?? ''));
  const skipped = rows.length - clean.length;
  if (!clean.length) return { vendors: 0, tagged: 0, skipped };

  // Existing budget lines (to TAG — never create/modify them here). Match by EXACT label, not
  // canonical category: itemized lines like "Food (dinner)" and "Beverage (wine + beer)" both
  // canonicalize to "Catering", so a category key would collapse them and mis-tag / drop one.
  const labelKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const { data: b } = await supabase.from('budget').select('id').eq('event_id', eventId).maybeSingle();
  const budgetId = (b as any)?.id as string | undefined;
  const lineByLabel = new Map<string, any>();
  if (budgetId) {
    const { data: blines } = await supabase.from('budget_line').select('id, label, linked_engagement').eq('budget_id', budgetId);
    for (const l of blines ?? []) if (l.label) lineByLabel.set(labelKey(l.label), l);
  }

  // Existing vendors, keyed by their name (engagement.category holds the supplier name here).
  const { data: engs } = await supabase.from('engagement').select('id, category').eq('event_id', eventId);
  const engByName = new Map<string, any>();
  for (const e of engs ?? []) if (e.category) engByName.set(e.category.trim().toLowerCase(), e);

  // Group rows by SUPPLIER (vendor name; fall back to category when a row has no named vendor).
  const groups = new Map<string, { name: string; rows: VendorListRow[] }>();
  for (const r of clean) {
    const name = (r.vendor && r.vendor.trim()) ? r.vendor.trim() : (r.category ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name, rows: [] });
    groups.get(key)!.rows.push(r);
  }

  let vendors = 0, tagged = 0;
  for (const { name, rows: grp } of groups.values()) {
    const stages = grp.map((r) => vendorStage(r.status));
    const stage = stages.includes('Contracted') ? 'Contracted' : 'Sourced';
    let eng = engByName.get(name.toLowerCase());
    if (!eng) {
      const id = genId('eng');
      const { error } = await supabase.from('engagement').insert({ id, event_id: eventId, category: name, stage, doc_url: docUrl });
      if (error) throw error;
      eng = { id, category: name };
      engByName.set(name.toLowerCase(), eng);
      vendors++;
    } else {
      await supabase.from('engagement').update({ stage, ...(docUrl ? { doc_url: docUrl } : {}) }).eq('id', eng.id);
    }
    // TAG existing budget lines whose line item this supplier provided — do NOT create or re-price.
    for (const r of grp) {
      const line = lineByLabel.get(labelKey(r.category));
      if (line && line.linked_engagement !== eng.id) {
        await supabase.from('budget_line').update({ linked_engagement: eng.id }).eq('id', line.id);
        line.linked_engagement = eng.id;
        tagged++;
      }
    }
  }
  return { vendors, tagged, skipped };
}

// ── Budget tracker ──────────────────────────────────────────────────────────
export async function addTrackerLine(budgetId: string, label: string, amount: number | null): Promise<BudgetLineTracker> {
  const id = genId('bl');
  const { error } = await supabase.from('budget_line').insert({ id, budget_id: budgetId, label, confirmed_amount: amount });
  if (error) throw error;
  return { id, label, confirmedAmount: amount, target: null, status: 'estimate', syncUrl: null, docUrl: null, note: null, linkedEngagement: null };
}
export async function setBudgetStatus(id: string, status: BudgetStatus): Promise<void> {
  const { error } = await supabase.from('budget_line').update({ payment_status: status }).eq('id', id);
  if (error) throw error;
}
export async function setBudgetSyncUrl(id: string, url: string | null): Promise<void> {
  const { error } = await supabase.from('budget_line').update({ sync_url: url }).eq('id', id);
  if (error) throw error;
}
export async function attachLineDoc(id: string, url: string | null): Promise<void> {
  const { error } = await supabase.from('budget_line').update({ doc_url: url }).eq('id', id);
  if (error) throw error;
}
/** Tag a budget line to a vendor engagement (or clear it with null). */
export async function setBudgetLineEngagement(id: string, engagementId: string | null): Promise<void> {
  const { error } = await supabase.from('budget_line').update({ linked_engagement: engagementId }).eq('id', id);
  if (error) throw error;
}
export async function setBudgetTarget(budgetId: string, target: number | null): Promise<void> {
  const { error } = await supabase.from('budget').update({ target_amount: target }).eq('id', budgetId);
  if (error) throw error;
}
/** Optional per-category target (setup step 2), separate from the projected estimate. */
export async function setBudgetLineTarget(lineId: string, target: number | null): Promise<void> {
  const { error } = await supabase.from('budget_line').update({ target }).eq('id', lineId);
  if (error) throw error;
}
/** Create a budget line for a projected category when the user first sets its target. */
export async function addBudgetCategoryTarget(budgetId: string, label: string, target: number | null): Promise<BudgetLineTracker> {
  const id = genId('bl');
  const { error } = await supabase.from('budget_line').insert({ id, budget_id: budgetId, label, target });
  if (error) throw error;
  return { id, label, confirmedAmount: null, target, status: 'estimate', syncUrl: null, docUrl: null, note: null, linkedEngagement: null };
}
/** Re-read a budget's lines (used to refresh in place after a drop-import). */
export async function listBudgetLines(budgetId: string): Promise<BudgetLineTracker[]> {
  const { data, error } = await supabase
    .from('budget_line')
    .select('id, label, confirmed_amount, target, payment_status, sync_url, doc_url, note, linked_engagement')
    .eq('budget_id', budgetId);
  if (error) throw error;
  return (data ?? []).map((l: any) => ({
    id: l.id, label: l.label, confirmedAmount: l.confirmed_amount ?? null, target: l.target ?? null,
    status: normBudgetStatus(l.payment_status), syncUrl: l.sync_url ?? null, docUrl: l.doc_url ?? null, note: l.note ?? null, linkedEngagement: l.linked_engagement ?? null,
  }));
}
/** Bulk-insert budget lines (from a dropped breakdown). Amount → confirmed_amount. */
export async function addBudgetLines(budgetId: string, lines: { label: string; amount: number | null }[]): Promise<void> {
  if (!lines.length) return;
  const rows = lines.map((l) => ({ id: genId('bl'), budget_id: budgetId, label: l.label, confirmed_amount: l.amount }));
  const { error } = await supabase.from('budget_line').insert(rows);
  if (error) throw error;
}
/** Re-import-safe replace: upsert dropped lines onto existing ones by canonical category
 *  (the natural key — A/V == "audio visual"), instead of delete-then-add. Matched lines have
 *  their amount UPDATED in place, preserving manually-set fields (target / status / note /
 *  links); new categories are inserted. With pruneMissing, categories absent from the drop are
 *  removed only AFTER the upserts succeed — so a mid-import failure can never empty the budget. */
export async function upsertBudgetLines(
  budgetId: string,
  lines: { label: string; amount: number | null }[],
  opts: { pruneMissing?: boolean } = {},
): Promise<void> {
  const existing = await listBudgetLines(budgetId);
  const byKey = new Map<string, BudgetLineTracker>();
  for (const l of existing) if (l.label) byKey.set(categoryKey(l.label), l);

  const incoming = new Set<string>();
  const toInsert: { label: string; amount: number | null }[] = [];
  for (const line of lines) {
    const key = categoryKey(line.label);
    incoming.add(key);
    const match = byKey.get(key);
    if (match) await updateBudgetLine(match.id, { amount: line.amount }); // preserve target/status/note/links
    else toInsert.push(line);
  }
  await addBudgetLines(budgetId, toInsert);
  if (opts.pruneMissing) {
    const stale = existing.filter((l) => !l.label || !incoming.has(categoryKey(l.label)));
    await Promise.all(stale.map((l) => deleteBudgetLine(l.id)));
  }
}
/** Classify a budget's lines for drop-import overwrite handling:
 *  empty (no lines) · projected (seeded estimates, nothing user-touched) · real (user data). */
export function classifyBudgetLines(lines: BudgetLineTracker[]): 'empty' | 'projected' | 'real' {
  if (lines.length === 0) return 'empty';
  const touched = lines.some((l) => l.status !== 'estimate' || l.target != null || l.linkedEngagement != null || l.docUrl != null || l.syncUrl != null);
  return touched ? 'real' : 'projected';
}

// ── Event setup walkthrough ──────────────────────────────────────────────────
/** Set the event date AND resolve the scaffolded deliverables' due dates from their
 *  offsets (resolved_due_date = date + due_offset_days). Clearing the date leaves
 *  resolved dates untouched. */
export async function setEventDate(eventId: string, date: string | null): Promise<void> {
  const { error } = await supabase.from('event').update({ event_date: date }).eq('id', eventId);
  if (error) throw error;
  if (!date) return;
  await graduateFromConcept(eventId); // setting a date on-site is essentials work (Luma writes raw, not here)
  // Resolve each deliverable's due date = event date + its day offset. Prefer the scaffold's
  // due_offset_days; fall back to offset_start (the start of a drop-ingest/template range) so
  // template-derived deliverables land on the timeline too.
  const { data: dels } = await supabase.from('deliverable').select('id, due_offset_days, offset_start').eq('event_id', eventId);
  const base = new Date(date + 'T00:00:00');
  await Promise.all((dels ?? [])
    .map((d: any) => ({ id: d.id, offset: d.due_offset_days ?? d.offset_start }))
    .filter((d) => d.offset != null)
    .map((d) => {
      const due = new Date(base);
      due.setDate(due.getDate() + d.offset);
      return supabase.from('deliverable').update({ resolved_due_date: due.toISOString().slice(0, 10) }).eq('id', d.id);
    }));
  // A newly-set date makes this event calendar-eligible — auto-sync.
  autoSyncGcal(eventId);
}
export async function setHeadcount(eventId: string, headcount: number | null): Promise<void> {
  const { error } = await supabase.from('event').update({ headcount }).eq('id', eventId);
  if (error) throw error;
  if (headcount != null) await graduateFromConcept(eventId);
}
export async function setEventBudgetTarget(eventId: string, target: number | null): Promise<void> {
  const { error } = await supabase.from('event').update({ event_budget_target: target }).eq('id', eventId);
  if (error) throw error;
  if (target != null) await graduateFromConcept(eventId);
}

export type BudgetApproval = {
  eventId: string;
  status: 'submitted' | 'assigned' | 'declined';
  requestedAmount: number | null;
  declineReason: string | null;
  decidedVia: 'app' | 'slack' | null;
  deciderRef: string | null;
  decidedAt: string | null;
  createdAt: string | null;
  slackChannel: string | null;
  slackMessageTs: string | null;
};

const toBudgetApproval = (r: any): BudgetApproval => ({
  eventId: r.event_id, status: r.status, requestedAmount: r.requested_amount ?? null,
  declineReason: r.decline_reason ?? null, decidedVia: r.decided_via ?? null, deciderRef: r.decider_ref ?? null,
  decidedAt: r.decided_at ?? null, createdAt: r.created_at ?? null, slackChannel: r.slack_channel ?? null, slackMessageTs: r.slack_message_ts ?? null,
});

export async function getBudgetApproval(eventId: string): Promise<BudgetApproval | null> {
  const { data } = await supabase.from('budget_approval').select('*').eq('event_id', eventId).maybeSingle();
  return data ? toBudgetApproval(data) : null;
}

/** New submissions write here directly (NOT via the migrate-on-read bridge). */
export async function submitBudgetApproval(eventId: string, opts: { requestedAmount: number | null; slackChannel: string | null; slackMessageTs?: string | null }): Promise<void> {
  const { error } = await supabase.from('budget_approval').upsert({
    event_id: eventId, status: 'submitted', requested_amount: opts.requestedAmount,
    slack_channel: opts.slackChannel, slack_message_ts: opts.slackMessageTs ?? null,
    decline_reason: null, decided_via: null, decider_ref: null, decided_at: null, updated_at: new Date().toISOString(),
  }, { onConflict: 'event_id' });
  if (error) throw error;
}

/** Sanctioned assign path: set the target via the existing writer, THEN flip approval state.
 *  Target first so we never mark 'assigned' without the target actually written. */
export async function assignBudget(eventId: string, amount: number, decider: { via: 'app' | 'slack'; ref: string } = { via: 'app', ref: 'app' }): Promise<void> {
  await setEventBudgetTarget(eventId, amount);
  const { error } = await supabase.from('budget_approval').upsert({
    event_id: eventId, status: 'assigned', decline_reason: null,
    decided_via: decider.via, decider_ref: decider.ref, decided_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'event_id' });
  if (error) throw error;
}

export async function declineBudget(eventId: string, reason: string, decider: { via: 'app' | 'slack'; ref: string } = { via: 'app', ref: 'app' }): Promise<void> {
  const { error } = await supabase.from('budget_approval').upsert({
    event_id: eventId, status: 'declined', decline_reason: reason,
    decided_via: decider.via, decider_ref: decider.ref, decided_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'event_id' });
  if (error) throw error;
}

/** Return an event to draft: remove its approval row entirely (no row = draft). */
export async function reopenBudgetApproval(eventId: string): Promise<void> {
  const { error } = await supabase.from('budget_approval').delete().eq('event_id', eventId);
  if (error) throw error;
}

/** One-time bridge: if there's no DB row yet but localStorage has a non-draft scoping, seed the DB
 *  row from it (and set the target for an already-assigned record via the sanctioned path). Returns
 *  the resulting approval. Safe to call on every load — no-ops once a row exists. */
export async function migrateScopingApprovalIfNeeded(eventId: string): Promise<BudgetApproval | null> {
  const existing = await getBudgetApproval(eventId);
  if (existing) return existing;
  const mapped = scopingToApproval(loadScoping(eventId));
  if (!mapped) return null;
  if (mapped.status === 'assigned' && mapped.assignedAmount != null) {
    await assignBudget(eventId, mapped.assignedAmount, { via: 'app', ref: 'migrated' });
    if (mapped.slackChannel) await supabase.from('budget_approval').update({ slack_channel: mapped.slackChannel }).eq('event_id', eventId);
  } else {
    await submitBudgetApproval(eventId, { requestedAmount: null, slackChannel: mapped.slackChannel });
  }
  return getBudgetApproval(eventId);
}

/** Persist setup progress (completed step keys) and the overall complete flag together. */
export async function saveSetupState(eventId: string, progress: string[], complete: boolean): Promise<void> {
  const { error } = await supabase.from('event').update({ setup_progress: progress, setup_complete: complete }).eq('id', eventId);
  if (error) throw error;
  // Finishing the essentials flow also graduates a freshly-drawn event out of 'Concept' (→ future)
  // to 'Planning' (→ in-process) — same graduation as any incremental "add" (see graduateFromConcept).
  if (complete) await graduateFromConcept(eventId);
}
/** Setup step 3: kick off outreach for a vendor category and record the inbox-watch intent. */
export async function startOutreach(engagementId: string, watchInbox: boolean): Promise<void> {
  const { error } = await supabase.from('engagement').update({ outreach_started: true, watch_inbox: watchInbox, stage: 'Sourced' }).eq('id', engagementId);
  if (error) throw error;
}
export async function setWatchInbox(engagementId: string, watchInbox: boolean): Promise<void> {
  const { error } = await supabase.from('engagement').update({ watch_inbox: watchInbox }).eq('id', engagementId);
  if (error) throw error;
}

export interface BudgetProjection {
  category: string;
  projected: number | null; // median of comparable past confirmed costs
  low: number | null;
  high: number | null;
  pastEvents: number;       // how many comparable events contributed a value
  lowConfidence: boolean;   // n <= 1
}

/** Per-category PROJECTED costs derived from comparable past events (same format).
 *  Pulls confirmed engagement costs + confirmed budget-line amounts, one value per
 *  past event per category, and reports the range + sample size as provenance. */
export async function getBudgetProjections(eventId: string, categories: string[]): Promise<BudgetProjection[]> {
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
  const wanted = new Map<string, string>(); // norm → display label (from the current event)
  for (const c of categories) { const k = norm(c); if (k && !wanted.has(k)) wanted.set(k, c.trim()); }
  if (wanted.size === 0) return [];

  // This event's format → comparable past events of the same format.
  const { data: self } = await supabase.from('event').select('format').eq('id', eventId).maybeSingle();
  const format = (self as any)?.format ?? null;
  let q = supabase.from('event').select('id').neq('id', eventId);
  q = format ? q.eq('format', format) : q.not('event_date', 'is', null);
  const { data: peers } = await q;
  const peerIds = (peers ?? []).map((r: any) => r.id);
  if (peerIds.length === 0) {
    return [...wanted.values()].map((category) => ({ category, projected: null, low: null, high: null, pastEvents: 0, lowConfidence: true }));
  }

  // amounts[normCategory] = Map<peerEventId, summed amount> — one value per event.
  const amounts = new Map<string, Map<string, number>>();
  const add = (cat: string | null, evId: string, amt: number | null) => {
    const k = norm(cat);
    if (!wanted.has(k) || amt == null) return;
    if (!amounts.has(k)) amounts.set(k, new Map());
    const m = amounts.get(k)!;
    m.set(evId, (m.get(evId) ?? 0) + amt);
  };

  const [{ data: engs }, { data: budgets }] = await Promise.all([
    supabase.from('engagement').select('event_id, category, confirmed_amount').in('event_id', peerIds).eq('stage', 'Contracted'),
    supabase.from('budget').select('event_id, lines:budget_line ( label, confirmed_amount )').in('event_id', peerIds),
  ]);
  for (const e of engs ?? []) add((e as any).category, (e as any).event_id, num((e as any).confirmed_amount));
  for (const b of budgets ?? []) for (const l of (b as any).lines ?? []) add((l as any).label, (b as any).event_id, num((l as any).confirmed_amount));

  return [...wanted.entries()].map(([k, category]) => {
    const vals = [...(amounts.get(k)?.values() ?? [])].sort((a, b) => a - b);
    const n = vals.length;
    const median = n === 0 ? null : n % 2 ? vals[(n - 1) / 2] : Math.round((vals[n / 2 - 1] + vals[n / 2]) / 2);
    return {
      category,
      projected: median,
      low: n ? vals[0] : null,
      high: n ? vals[n - 1] : null,
      pastEvents: n,
      lowConfidence: n <= 1,
    };
  });
}

// ── Deliverables ────────────────────────────────────────────────────────────
export async function addDeliverable(eventId: string, fields: { title: string; phase: string; ownerRole: string | null; dueDate: string | null; offsetStart?: number | null; offsetEnd?: number | null; locked?: boolean }): Promise<Deliverable> {
  const id = genId('del');
  const { error } = await supabase.from('deliverable').insert({
    id, event_id: eventId, title: fields.title, phase: fields.phase, owner_role: fields.ownerRole, resolved_due_date: fields.dueDate, status: 'Todo',
    offset_start: fields.offsetStart ?? null, offset_end: fields.offsetEnd ?? null, locked: fields.locked ?? false,
  });
  if (error) throw error;
  await graduateFromConcept(eventId);
  return { id, title: fields.title, phase: fields.phase, ownerRole: fields.ownerRole, dueDate: fields.dueDate, offsetStart: fields.offsetStart ?? null, offsetEnd: fields.offsetEnd ?? null, status: 'Todo', linearIssueId: null, linearIssueUrl: null, locked: fields.locked ?? false };
}
export async function setDeliverableStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase.from('deliverable').update({ status }).eq('id', id);
  if (error) throw error;
}
/** Move a deliverable to a different phase/section (drag-and-drop). Doesn't touch its T-offsets. */
export async function setDeliverablePhase(id: string, phase: string): Promise<void> {
  const { error } = await supabase.from('deliverable').update({ phase }).eq('id', id);
  if (error) throw error;
}
/** Count an event's deliverables, total and not-yet-Done — used to phrase a bulk-action confirm. */
export async function getDeliverableCounts(eventId: string): Promise<{ total: number; open: number }> {
  const { data } = await supabase.from('deliverable').select('status').eq('event_id', eventId);
  const rows = data ?? [];
  return { total: rows.length, open: rows.filter((d) => d.status !== 'Done').length };
}
/** Set the status on EVERY deliverable of an event (e.g. a bulk "mark everything done"). Returns
 *  how many rows changed (those not already at `status`), so a caller can confirm honestly. */
export async function setAllDeliverablesStatus(eventId: string, status: string): Promise<number> {
  const { data, error } = await supabase
    .from('deliverable').update({ status }).eq('event_id', eventId).neq('status', status).select('id');
  if (error) throw error;
  return data?.length ?? 0;
}
/** Fetch a deliverable's title + Linear linkage (for confirmation messages with a ticket link). */
export async function getDeliverableLinear(id: string): Promise<{ title: string; linearIssueId: string | null; linearIssueUrl: string | null } | null> {
  const { data } = await supabase.from('deliverable').select('title, linear_issue_id, linear_issue_url').eq('id', id).maybeSingle();
  if (!data) return null;
  return { title: (data as any).title, linearIssueId: (data as any).linear_issue_id ?? null, linearIssueUrl: (data as any).linear_issue_url ?? null };
}
/** Manually override a deliverable's due date (yyyy-mm-dd, or null to clear). */
export async function setDeliverableDueDate(id: string, date: string | null): Promise<void> {
  const { error } = await supabase.from('deliverable').update({ resolved_due_date: date }).eq('id', id);
  if (error) throw error;
}
/** Set a deliverable's timeline offset (days from event date) — used when drag-reordering the
 *  run of show retimes a task to sit between its new neighbors. Optionally also resolves a date. */
export async function setDeliverableOffset(id: string, offsetStart: number | null, offsetEnd: number | null, dueDate?: string | null): Promise<void> {
  const patch: Record<string, unknown> = { offset_start: offsetStart, offset_end: offsetEnd };
  if (dueDate !== undefined) patch.resolved_due_date = dueDate;
  const { error } = await supabase.from('deliverable').update(patch).eq('id', id);
  if (error) throw error;
}
export async function deleteDeliverable(id: string): Promise<void> {
  const { error } = await supabase.from('deliverable').delete().eq('id', id);
  if (error) throw error;
}

// ── Auto-update activity feed (email / Linear / manual) ──────────────────────
export interface EventUpdate {
  id: string;
  source: string; // 'email' | 'linear' | 'manual'
  summary: string;
  detail: string | null;
  linkUrl: string | null;
  engagementId: string | null;
  deliverableId: string | null;
  createdAt: string;
}

export async function listEventUpdates(eventId: string): Promise<EventUpdate[]> {
  const { data, error } = await supabase
    .from('event_update')
    .select('id, source, summary, detail, link_url, engagement_id, deliverable_id, created_at')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((u: any) => ({
    id: u.id, source: u.source, summary: u.summary, detail: u.detail ?? null,
    linkUrl: u.link_url ?? null, engagementId: u.engagement_id ?? null, deliverableId: u.deliverable_id ?? null,
    createdAt: u.created_at,
  }));
}

export async function recordEventUpdate(eventId: string, f: {
  source: string; summary: string; detail?: string | null; linkUrl?: string | null;
  engagementId?: string | null; deliverableId?: string | null;
}): Promise<EventUpdate> {
  const id = genId('upd');
  const row = {
    id, event_id: eventId, source: f.source, summary: f.summary, detail: f.detail ?? null,
    link_url: f.linkUrl ?? null, engagement_id: f.engagementId ?? null, deliverable_id: f.deliverableId ?? null,
  };
  const { error } = await supabase.from('event_update').insert(row);
  if (error) throw error;
  // created_at isn't returned by insert here; approximate with now for the optimistic row.
  return { id, source: f.source, summary: f.summary, detail: f.detail ?? null, linkUrl: f.linkUrl ?? null,
    engagementId: f.engagementId ?? null, deliverableId: f.deliverableId ?? null, createdAt: new Date().toISOString() };
}

/** Claude digest of one vendor decision's correspondence (null if no key/none). */
export async function summarizeCorrespondence(eventId: string, engagementId: string): Promise<string | null> {
  try {
    const { data } = await supabase.functions.invoke('summarize-correspondence', { body: { eventId, engagementId } });
    const s = (data as any)?.summary;
    return s && typeof s === 'string' ? s : null;
  } catch { return null; }
}

/** Pull recent Gmail from the event's vendor domains into the feed as correspondence. */
export async function syncGmail(eventId: string): Promise<{ matched: number; recorded: number; scannedDomains: number; note?: string }> {
  const { data, error } = await supabase.functions.invoke('gmail-sync', { body: { eventId } });
  if (error || (data as any)?.error) throw new Error((data as any)?.error ?? error?.message ?? 'sync failed');
  return data as { matched: number; recorded: number; scannedDomains: number; note?: string };
}

// What the detector proposes from a pasted email / Linear note.
export interface DetectedUpdate {
  kind: 'contract' | 'complete' | 'status' | 'note';
  status?: string | null;     // target status when kind='status' (Todo | In Progress | Done)
  engagementId: string | null;
  deliverableId: string | null;
  matchedName: string | null; // vendor/category or deliverable matched
  summary: string;
}

/** Classify + match an inbound email/Linear note against this event's vendors and
 *  deliverables (server-side: Claude when keyed, heuristic otherwise). */
export async function detectUpdate(eventId: string, text: string, source: string, from?: string | null): Promise<DetectedUpdate> {
  const { data, error } = await supabase.functions.invoke('detect-update', { body: { eventId, text, source, from } });
  if (error) throw new Error((data as any)?.error ?? error.message ?? 'detection failed');
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as DetectedUpdate;
}

// ── Planning at-a-glance digest ──────────────────────────────────────────────
export interface PlanningFacts {
  name: string;
  macroStage: string | null;
  daysOut: number | null;
  confirmed: { category: string; vendor: string | null; amount: number | null }[];
  pendingDecisions: { category: string; stage: string }[];
  budget: { committed: number; paid: number; pending: number; target: number | null } | null;
  deliverables: { done: number; total: number; overdue: number; upcoming: string[] };
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

/** Deterministic digest — always available; Claude rephrases it when a key is set. */
function summaryFallback(f: PlanningFacts): string {
  const parts: string[] = [];
  const when = f.daysOut == null ? "" : f.daysOut > 0 ? `, ${f.daysOut} days out` : f.daysOut === 0 ? ", today" : `, ${-f.daysOut} days ago`;
  parts.push(`${f.name} is in ${f.macroStage ?? "planning"}${when}.`);
  if (f.confirmed.length) {
    parts.push(`Confirmed: ${f.confirmed.map((c) => `${c.category}${c.vendor ? ` — ${c.vendor}` : ""} (${fmtMoney(c.amount)})`).join(", ")}.`);
  }
  if (f.pendingDecisions.length) {
    parts.push(`Still open: ${f.pendingDecisions.map((p) => `${p.category} (${p.stage})`).join(", ")}.`);
  }
  if (f.budget) parts.push(`${fmtMoney(f.budget.committed)} committed${f.budget.target != null ? ` of ${fmtMoney(f.budget.target)} target` : ""}, ${fmtMoney(f.budget.paid)} paid.`);
  parts.push(`Deliverables ${f.deliverables.done}/${f.deliverables.total} done${f.deliverables.overdue ? `, ${f.deliverables.overdue} overdue` : ""}.`);
  if (f.deliverables.upcoming.length) parts.push(`Coming up: ${f.deliverables.upcoming.join(", ")}.`);
  return parts.join("\n"); // one fact per line → rendered as bullet points
}

/** Persist the Overview digest so it isn't regenerated on every view. */
export async function saveOverviewSummary(eventId: string, summary: string): Promise<void> {
  const { error } = await supabase.from('event').update({ overview_summary: summary }).eq('id', eventId);
  if (error) throw error;
}

// Whole-array replace for the brief-sourced prose lists (run-of-show, staffing, guardrails).
export async function setEventAgenda(eventId: string, agenda: RunOfShowItem[]): Promise<void> {
  const { error } = await supabase.from('event').update({ agenda }).eq('id', eventId);
  if (error) throw error;
}
export async function setEventStaffRoles(eventId: string, roles: string[]): Promise<void> {
  const { error } = await supabase.from('event').update({ staff_roles: roles }).eq('id', eventId);
  if (error) throw error;
}
export async function setEventReflections(eventId: string, reflections: string[]): Promise<void> {
  const { error } = await supabase.from('event').update({ reflections }).eq('id', eventId);
  if (error) throw error;
}
/** Attach the original dropped files (already uploaded to storage) for reference. */
export async function setEventMaterials(eventId: string, materials: SourceMaterial[]): Promise<void> {
  const { error } = await supabase.from('event').update({ source_materials: materials }).eq('id', eventId);
  if (error) throw error;
}
export async function setEventOutreach(eventId: string, outreach: OutreachTemplate[]): Promise<void> {
  const { error } = await supabase.from('event').update({ outreach }).eq('id', eventId);
  if (error) throw error;
}

export async function getPlanningSummary(facts: PlanningFacts): Promise<string> {
  try {
    const { data } = await supabase.functions.invoke('planning-summary', { body: { facts } });
    const s = (data as any)?.summary;
    if (s && typeof s === 'string') return s;
  } catch { /* fall through */ }
  return summaryFallback(facts);
}

// ── Carried lessons (Claude-curated comparable past reflections) ─────────────
export async function getCarriedLessons(eventId: string): Promise<CarriedLesson[]> {
  try {
    const { data, error } = await supabase.functions.invoke('comparable-lessons', { body: { eventId } });
    if (error || (data as any)?.error) return [];
    return ((data as any)?.lessons ?? []) as CarriedLesson[];
  } catch {
    return [];
  }
}

// ── Post-event debrief ───────────────────────────────────────────────────────
// V0 degrade path: book the 30-min debrief as an in-app locked deliverable (a reminder/task)
// the day after the event. Idempotent — never creates a second debrief. Live Google Calendar
// booking (free/busy + invites) is a confirm-first action that needs the calendar connector
// wired server-side; until then this is the reminder/task fallback the spec calls for.
// ── Wrap & write-back (settling lifecycle) ───────────────────────────────────
export type SettleState = 'just_wrapped' | 'debriefed' | 'settled';
/** Advance the post-event settling lifecycle (just_wrapped → debriefed → settled). */
export async function setSettleState(eventId: string, state: SettleState): Promise<void> {
  const { error } = await supabase.from('event').update({ settle_state: state }).eq('id', eventId);
  if (error) throw error;
}
/** Record the event's outcome / one-line verdict. */
export async function setEventVerdict(eventId: string, verdict: string | null): Promise<void> {
  const { error } = await supabase.from('event').update({ verdict: verdict?.trim() || null }).eq('id', eventId);
  if (error) throw error;
}
/** Persist raw debrief notes on the event as project knowledge. */
export async function saveDebriefNotes(eventId: string, notes: string | null): Promise<void> {
  const { error } = await supabase.from('event').update({ debrief_notes: notes?.trim() || null }).eq('id', eventId);
  if (error) throw error;
}
/** Resolve staff roles → people at settle time (role name → assignee). Empty values are dropped. */
export async function setRoleAssignments(eventId: string, assignments: Record<string, string>): Promise<void> {
  const clean: Record<string, string> = {};
  for (const [role, who] of Object.entries(assignments)) { const v = who?.trim(); if (v) clean[role] = v; }
  const { error } = await supabase.from('event').update({ role_assignments: clean }).eq('id', eventId);
  if (error) throw error;
}
/** Settle the event atomically (mark settled + carry its reflections back to the modeled-on
 *  template). Returns how many reflections were newly carried over. */
export async function settleEvent(eventId: string): Promise<{ settled: boolean; template: string | null; reflectionsCarried: number }> {
  const { data, error } = await supabase.rpc('settle_event', { p_event_id: eventId });
  if (error) throw error;
  const r = (data ?? {}) as any;
  return { settled: !!r.settled, template: r.template ?? null, reflectionsCarried: r.reflectionsCarried ?? 0 };
}

export async function scheduleDebrief(eventId: string, dueDate: string, phase: string): Promise<Deliverable | null> {
  const { data: existing } = await supabase.from('deliverable').select('id').eq('event_id', eventId).ilike('title', '%debrief%').limit(1);
  if (existing?.length) return null; // already scheduled — don't double-book
  return addDeliverable(eventId, { title: 'Event debrief (30 min)', phase, ownerRole: 'Event owner', dueDate, offsetStart: 1, locked: true });
}

/** Preview carried lessons for an event still being drafted (no row yet) — matched on the
 *  draft's description/format/tags and the past event it's modeled on. */
export async function previewCarriedLessons(draft: {
  name?: string; format?: string | null; tags?: string[]; modeledOnEventId?: string | null;
}): Promise<CarriedLesson[]> {
  try {
    const { data, error } = await supabase.functions.invoke('comparable-lessons', { body: { draft } });
    if (error || (data as any)?.error) return [];
    return ((data as any)?.lessons ?? []) as CarriedLesson[];
  } catch {
    return [];
  }
}

// ── People tagging ("who mattered") ──────────────────────────────────────────
// Event-scoped, provenance-carrying tags that roll up to the person. Multiple lenses per
// person allowed (one row per attendee+event+lens). Feeders propose (status='proposed');
// humans confirm. Manual in-app tags are confirmed on creation. Dedupe stays on the attendee
// (email) layer — this just hangs tags off attendee_id.
export type TagLens = 'candidate' | 'prospect' | 'partner';
export type TagSource = 'debrief' | 'slack' | 'manual';
export const TAG_LENSES: TagLens[] = ['candidate', 'prospect', 'partner'];
export interface PersonTag {
  id: string;
  attendeeId: string;
  eventId: string | null;
  lens: TagLens;
  priority: boolean;       // star
  note: string | null;     // the "why"
  followUp: boolean;
  source: TagSource;
  sourceRef: string | null; // link / quote / "@14:02"
  status: 'proposed' | 'confirmed';
  createdBy: string | null;
  createdAt: string;
}
// An event's tag joined with the person + a cross-event roll-up (×N events this person is tagged).
export interface EventPersonTag extends PersonTag {
  name: string | null;
  email: string | null;
  rollupEvents: number;
}

function mapTag(r: any): PersonTag {
  return {
    id: r.id, attendeeId: r.attendee_id, eventId: r.event_id ?? null, lens: r.lens,
    priority: !!r.priority, note: r.note ?? null, followUp: !!r.follow_up,
    source: r.source, sourceRef: r.source_ref ?? null, status: r.status,
    createdBy: r.created_by ?? null, createdAt: r.created_at,
  };
}

/** All tags on an event, joined with the person + their cross-event tag-count (signal strength). */
export async function listEventTags(eventId: string): Promise<EventPersonTag[]> {
  const { data, error } = await supabase
    .from('person_tag')
    .select('id, attendee_id, event_id, lens, priority, note, follow_up, source, source_ref, status, created_by, created_at, attendee:attendee ( name, email )')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  // Roll-up: distinct events each tagged person appears in, across all their tags.
  const ids = Array.from(new Set(rows.map((r: any) => r.attendee_id)));
  const rollup = new Map<string, number>();
  if (ids.length) {
    const { data: all } = await supabase.from('person_tag').select('attendee_id, event_id').in('attendee_id', ids);
    const byPerson = new Map<string, Set<string>>();
    for (const r of all ?? []) { const s = byPerson.get(r.attendee_id) ?? new Set<string>(); if (r.event_id) s.add(r.event_id); byPerson.set(r.attendee_id, s); }
    for (const [k, v] of byPerson) rollup.set(k, v.size);
  }
  return rows.map((r: any) => ({ ...mapTag(r), name: r.attendee?.name ?? null, email: r.attendee?.email ?? null, rollupEvents: rollup.get(r.attendee_id) || 1 }));
}

/** Apply/refresh a lens tag. Manual tags confirm immediately; feeders pass status:'proposed'.
 *  Idempotent on (attendee, event, lens). */
export async function tagPerson(
  attendeeId: string, eventId: string, lens: TagLens,
  opts: { createdBy?: string | null; source?: TagSource; sourceRef?: string | null; status?: 'proposed' | 'confirmed'; note?: string | null; priority?: boolean; followUp?: boolean } = {},
): Promise<PersonTag> {
  const row = {
    id: genId('ptag'), attendee_id: attendeeId, event_id: eventId, lens,
    priority: opts.priority ?? false, note: opts.note ?? null, follow_up: opts.followUp ?? false,
    source: opts.source ?? 'manual', source_ref: opts.sourceRef ?? null,
    status: opts.status ?? 'confirmed', created_by: opts.createdBy ?? null,
  };
  const { data, error } = await supabase.from('person_tag').upsert(row, { onConflict: 'attendee_id,event_id,lens' }).select().single();
  if (error) throw error;
  return mapTag(data);
}

export async function untagLens(attendeeId: string, eventId: string, lens: TagLens): Promise<void> {
  const { error } = await supabase.from('person_tag').delete().eq('attendee_id', attendeeId).eq('event_id', eventId).eq('lens', lens);
  if (error) throw error;
}

/** Person↔event-level controls (star / note / follow-up) — applied across the person's lens rows. */
export async function setPersonEventTagFields(attendeeId: string, eventId: string, fields: { priority?: boolean; note?: string | null; followUp?: boolean }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if ('priority' in fields) patch.priority = fields.priority;
  if ('note' in fields) patch.note = fields.note;
  if ('followUp' in fields) patch.follow_up = fields.followUp;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from('person_tag').update(patch).eq('attendee_id', attendeeId).eq('event_id', eventId);
  if (error) throw error;
}

export async function confirmTag(tagId: string): Promise<void> {
  const { error } = await supabase.from('person_tag').update({ status: 'confirmed' }).eq('id', tagId);
  if (error) throw error;
}
export async function dismissTag(tagId: string): Promise<void> {
  const { error } = await supabase.from('person_tag').delete().eq('id', tagId);
  if (error) throw error;
}
