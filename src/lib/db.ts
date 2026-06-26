import { supabase } from './supabase';
import { PAGE_PUBLIC_FIELDS } from './page';
import { dueOffsetForTitle } from './schedule';
import { matchFormat } from './formats';

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
  coverImageUrl: string | null; // active/displayed cover
  lumaCoverUrl: string | null;
  customCoverUrl: string | null;
  coverPosition: string | null;
  labelIds: string[];
  macroStage: string | null; // set ⇒ an event we're actively planning (routes to the planning view)
  isTemplate: boolean; // a reusable Event Type (open slots), not a concrete instance
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

// An event being planned (macro_stage set) is in-process by nature — except 'Wrap',
// which is the post-event wind-down.
function statusFromMacroStage(stage: string): EventStatus {
  const k = stage.toLowerCase();
  return k === 'wrap' || k === 'wrapped' ? 'past' : 'in-process';
}

// Resolve an event's coarse status: a manual override wins, then macro_stage, then
// the series status, then the date.
function resolveStatus(row: any, series: SeriesJoin): EventStatus {
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
    coverImageUrl: row.cover_image_url ?? null,
    lumaCoverUrl: row.luma_cover_url ?? null,
    customCoverUrl: row.custom_cover_url ?? null,
    coverPosition: row.cover_position ?? null,
    labelIds: (row.event_label ?? []).map((l: any) => l.label_id),
    macroStage: row.macro_stage ?? null,
    isTemplate: row.is_template ?? false,
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
}

/** Permanently delete an event. FKs cascade (engagements, budget+lines, deliverables,
 *  attendee links, owners, labels, …); shared attendees stay. No undo. */
export async function deleteEvent(eventId: string): Promise<void> {
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
}): Promise<string> {
  const eventId = newId('evt');
  // Snap the format to the closest existing one before storing (no near-duplicate formats).
  const format = await canonicalizeFormat(input.format ?? null);
  const { error: eErr } = await supabase.from('event').insert({
    id: eventId, name: input.name, event_date: input.date, location: input.location, format,
    start_time: input.startTime ?? null, end_time: input.endTime ?? null,
    phases: input.phases ?? [], planning_lead_time: input.planningLeadTime ?? null,
    agenda: input.agenda ?? [], staff_roles: input.staffRoles ?? [], reflections: input.reflections ?? [],
    walkthrough: input.walkthrough ?? [], heuristics: input.heuristics ?? [], outreach: input.outreach ?? [],
    is_template: input.isTemplate ?? false,
    tags: input.tags, macro_stage: 'Planning', modeled_on_event_id: input.modeledOnEventId ?? null,
    hosting: input.hosting ?? 'solo', co_host: input.hosting === 'cohost' ? (input.coHost?.trim() || null) : null,
  });
  if (eErr) throw eErr;

  const engRows = input.template.vendorCategories.map((cat) => ({ id: newId('eng'), event_id: eventId, category: cat, stage: 'Sourced' }));
  if (engRows.length) { const { error } = await supabase.from('engagement').insert(engRows); if (error) throw error; }

  const budgetId = newId('bud');
  const { error: bErr } = await supabase.from('budget').insert({ id: budgetId, event_id: eventId, currency: 'USD' });
  if (bErr) throw bErr;
  const lineRows = input.template.budgetLines.map((l) => ({ id: newId('bl'), budget_id: budgetId, label: l.label, confirmed_amount: l.estimate }));
  if (lineRows.length) { const { error } = await supabase.from('budget_line').insert(lineRows); if (error) throw error; }

  // Seed each workstream's due offset from the standard schedule (compressed if the
  // planning window is short). When the date is known at creation, resolve concrete due
  // dates right away (date + offset); otherwise the setup walkthrough resolves them once
  // the date is set.
  const startDate = new Date().toISOString().slice(0, 10);
  const base = input.date ? new Date(input.date + 'T00:00:00') : null;
  const delRows = input.template.progressCategories.map((p) => {
    const offset = dueOffsetForTitle(p, input.date, startDate);
    let resolved: string | null = null;
    if (base) { const due = new Date(base); due.setDate(due.getDate() + offset); resolved = due.toISOString().slice(0, 10); }
    return { id: newId('del'), event_id: eventId, title: p, phase: 'Planning', status: 'Todo', due_offset_days: offset, resolved_due_date: resolved };
  });
  if (delRows.length) { const { error } = await supabase.from('deliverable').insert(delRows); if (error) throw error; }

  // Every event/template carries a non-deletable post-event post-mortem deliverable.
  // Placed in the last phase (else "Wrap"), a couple days after the event (offset +2).
  const lastPhase = (input.phases ?? []).slice().sort((a, b) => a.order - b.order).pop()?.name ?? 'Wrap';
  const pmOffset = 2;
  const pmDue = base ? (() => { const d = new Date(base); d.setDate(d.getDate() + pmOffset); return d.toISOString().slice(0, 10); })() : null;
  { const { error } = await supabase.from('deliverable').insert({ id: newId('del'), event_id: eventId, title: 'Post-event reflections & insights', phase: lastPhase, status: 'Todo', offset_start: pmOffset, resolved_due_date: pmDue, locked: true }); if (error) throw error; }

  return eventId;
}

/** Persist a backfilled past event (no template). Returns the new event id. */
export async function backfillEvent(input: { name: string; date: string | null; location: string | null; description: string | null }): Promise<string> {
  const id = newId('evt');
  const { error } = await supabase.from('event').insert({
    id, name: input.name, event_date: input.date, location: input.location, description: input.description,
  });
  if (error) throw error;
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

/** Upload a dropped file to the attachments bucket; returns its public URL. */
export async function uploadAttachment(file: File): Promise<string> {
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot) : '';
  const path = `${newId('att')}${ext}`;
  const { error } = await supabase.storage.from('attachments').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return supabase.storage.from('attachments').getPublicUrl(path).data.publicUrl;
}

// ── Event page ownership / dev round-trip (Assembly side) ────────────────────

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
export async function createProfile(name: string, email: string | null, color: string): Promise<Profile> {
  const id = newId('prof');
  const { error } = await supabase.from('profile').insert({ id, name, email, color });
  if (error) throw error;
  return { id, name, email, color, createdAt: new Date().toISOString(), isAdmin: false };
}
export async function updateProfile(id: string, fields: { name?: string; email?: string | null }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if ('name' in fields) patch.name = fields.name;
  if ('email' in fields) patch.email = fields.email;
  const { error } = await supabase.from('profile').update(patch).eq('id', id);
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
  },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if ('name' in fields) patch.name = fields.name;
  if ('description' in fields) patch.description = fields.description;
  if ('coverPosition' in fields) patch.cover_position = fields.coverPosition;
  if ('format' in fields) patch.format = fields.format;
  if ('audience' in fields) patch.audience = fields.audience;
  if ('location' in fields) patch.location = fields.location;
  if ('startTime' in fields) patch.start_time = fields.startTime;
  if ('endTime' in fields) patch.end_time = fields.endTime;
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
    .select('id, name, email, title, org, type, is_aggregate, count_est, note, school, city, industry, linkedin_url, photo_url, application_status, greenhouse_last_synced, attendee_label ( label_id ), attendee_event ( event:event ( event_date, location ) )')
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
      eventsCount: links.length,
      eventDates: links.map((l: any) => l.event?.event_date).filter(Boolean),
      eventCities: Array.from(new Set(links.map((l: any) => l.event?.location).filter(Boolean))),
      applicationStatus: r.application_status ?? null,
      greenhouseLastSynced: r.greenhouse_last_synced ?? null,
    };
  });
}

/** Attendees linked to one event, with their per-event role + Luma status. */
export async function listAttendeesForEvent(eventId: string): Promise<PersonView[]> {
  const { data, error } = await supabase
    .from('attendee_event')
    .select('role_at_event, registration_status, checked_in, attendee:attendee ( id, name, email, title, org, type, is_aggregate, count_est, note, school, city, industry, linkedin_url, photo_url, application_status, greenhouse_last_synced, attendee_label ( label_id ), attendee_event ( count ) )')
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
  const { error: aErr } = await supabase.from('attendee').insert({
    id, name: fields.name, title: fields.title ?? null, org: fields.org ?? null, email: fields.email ?? null, type: 'Unknown',
  });
  if (aErr) throw aErr;
  const { error: lErr } = await supabase.from('attendee_event').insert({
    id: newId('ae'), attendee_id: id, event_id: eventId, role_at_event: fields.isSpeaker ? 'speaker' : 'attendee',
  });
  if (lErr) throw lErr;
  const internalId = await labelInternalIfInstalily(id, fields.email ?? null);
  return {
    id, name: fields.name, email: fields.email ?? null, title: fields.title ?? null, org: fields.org ?? null,
    type: 'Unknown', isAggregate: false, countEst: null, note: null, school: null, city: null, industry: null,
    linkedinUrl: null, photoUrl: null, labelIds: internalId ? [internalId] : [], eventsCount: 1, eventDates: [], eventCities: [],
    applicationStatus: null, greenhouseLastSynced: null,
    role: fields.isSpeaker ? 'speaker' : 'attendee', registrationStatus: null, checkedIn: false,
  };
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
  await Promise.all(orderedAttendeeIds.map((aid, i) =>
    supabase.from('attendee_event').update({ speaker_order: i }).eq('event_id', eventId).eq('attendee_id', aid)));
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
    .select('event:event ( id, name, is_template, phases )')
    .eq('profile_id', profileId);
  if (oErr) throw oErr;
  const events = (owned ?? []).map((r: any) => r.event).filter((e: any) => e && !e.is_template);
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
  deliverables: { title: string; phase: string; offsetStart: number | null; offsetEnd: number | null }[];
  vendors: string[]; staff: string[]; agenda: { time: string; title: string }[];
  walkthrough: WalkStep[]; outreach: OutreachTemplate[]; budgetTotal: number | null;
}
/** Extract a dropped brief into structured fields via Claude (server-side). */
export async function extractBrief(text: string): Promise<ExtractedBrief> {
  const { data, error } = await supabase.functions.invoke('extract-brief', { body: { text } });
  if (error) {
    const msg = (data as any)?.error ?? error.message ?? String(error);
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as ExtractedBrief;
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
): Promise<{ gcalEventId: string; calendarId: string; htmlLink: string | null }> {
  const { data, error } = await supabase.functions.invoke('gcal-sync', { body: { eventId } });
  if (error) {
    let msg = (data as any)?.error ?? error.message ?? String(error);
    try { const body = await (error as any).context?.json?.(); if (body?.error) msg = body.error; } catch { /* keep generic */ }
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as any;
}

/** Mirror this event + all its deliverables into Linear: the event becomes a Project under the
 *  single "EventHub" team, and each deliverable an Issue in that project. Idempotent — re-running
 *  updates existing issues. Server-side holds the Linear API key. */
export async function syncEventToLinear(
  eventId: string,
): Promise<{ teamId: string; projectId: string; projectUrl: string | null; synced: number; total: number }> {
  const { data, error } = await supabase.functions.invoke('linear-sync', { body: { eventId } });
  if (error) {
    let msg = (data as any)?.error ?? error.message ?? String(error);
    try { const body = await (error as any).context?.json?.(); if (body?.error) msg = body.error; } catch { /* keep generic */ }
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as any;
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

export async function listEvents(): Promise<EventListItem[]> {
  const { data, error } = await supabase
    .from('event')
    .select(
      'id, name, tag, tags, format, location, office, event_date, start_time, end_time, rsvp, capacity, checked_in, macro_stage, owning_team, status, is_template, owners:event_owner ( profile:profile ( id, name, color ) ), series_id, luma_event_id, luma_url, luma_name, gcal_event_id, gcal_html_link, cover_image_url, luma_cover_url, custom_cover_url, cover_position, event_label ( label_id ), series:event_series ( id, name, type, status, owning_team )',
    )
    .order('id');
  if (error) throw error;
  return (data ?? []).map(toListItem);
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

  return {
    ...toListItem(row),
    description: (row as any).description ?? null,
    audience: (row as any).audience ?? null,
    actualAttendanceNote: (row as any).actual_attendance_note ?? null,
    checkedIn: (row as any).checked_in ?? null,
    waitlistAdmitted: (row as any).waitlist_admitted ?? null,
    notes: (row as any).notes ?? [],
    sourceMaterials: Array.isArray((row as any).source_materials) ? (row as any).source_materials as SourceMaterial[] : [],
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
  const rows = await Promise.all(
    (data ?? []).map(async (e: any) => {
      const s = await getEventPeopleStats(e.id);
      return {
        event: e.name,
        tag: e.tag ?? '',
        date: e.event_date ?? '',
        location: e.location ?? e.office ?? '',
        registered: s.registered,
        checked_in: s.checkedIn,
        total: s.total,
      };
    }),
  );
  return rows;
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
export const ENGAGEMENT_STAGES = ['Sourced', 'Quoted', 'Selected', 'Contracted'] as const;
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
export const BUDGET_STATUSES = ['estimate', 'quoted', 'in_review', 'paid'] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];
/** Map any stored value (incl. legacy 'pending'/null) to a current status. */
export function normBudgetStatus(s: any): BudgetStatus {
  if (s === 'paid' || s === 'quoted' || s === 'in_review') return s;
  if (s === 'pending' || s === 'committed') return 'in_review'; // legacy
  return 'estimate';
}
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
  why: string;
}
export interface EventPlanning {
  id: string;
  title: string;
  tags: string[];
  format: string | null;
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
  isTemplate: boolean;
  capacity: number | null;
  rsvp: number | null;
  owner: string | null;
  owners: { id: string; name: string; color: string | null }[];
  macroStage: string | null;
  status: EventStatus;
  overviewSummary: string | null;
  lumaUrl: string | null;
  lumaEventId: string | null;
  gcalEventId: string | null;
  gcalHtmlLink: string | null;
  linearProjectId: string | null;
  linearProjectUrl: string | null;
  coverImageUrl: string | null;
  lumaCoverUrl: string | null;
  customCoverUrl: string | null;
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
    .select('id, name, tags, format, location, office, description, event_date, start_time, end_time, phases, planning_lead_time, agenda, staff_roles, reflections, walkthrough, heuristics, outreach, source_materials, is_template, capacity, rsvp, headcount, macro_stage, owning_team, status, setup_complete, event_budget_target, setup_progress, owners:event_owner ( profile:profile ( id, name, color ) ), overview_summary, luma_url, luma_event_id, page_ownership, repo_ref, last_deploy_status, preview_url, live_url, ejected_at, ejected_snapshot, page_draft, cover_image_url, luma_cover_url, custom_cover_url, gcal_event_id, gcal_html_link, linear_project_id, linear_project_url, series:event_series ( owning_team, status )')
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

  return {
    id: row.id,
    title: (row as any).name,
    tags: (row as any).tags ?? [],
    format: (row as any).format ?? null,
    location: (row as any).location ?? (row as any).office ?? null,
    description: (row as any).description ?? null,
    phases: Array.isArray((row as any).phases) ? (row as any).phases as EventPhase[] : [],
    planningLeadTime: (row as any).planning_lead_time ?? null,
    agenda: Array.isArray((row as any).agenda) ? (row as any).agenda as RunOfShowItem[] : [],
    staffRoles: Array.isArray((row as any).staff_roles) ? (row as any).staff_roles as string[] : [],
    reflections: Array.isArray((row as any).reflections) ? (row as any).reflections as string[] : [],
    walkthrough: Array.isArray((row as any).walkthrough) ? (row as any).walkthrough as WalkStep[] : [],
    heuristics: Array.isArray((row as any).heuristics) ? (row as any).heuristics as string[] : [],
    outreach: Array.isArray((row as any).outreach) ? (row as any).outreach as OutreachTemplate[] : [],
    sourceMaterials: Array.isArray((row as any).source_materials) ? (row as any).source_materials as SourceMaterial[] : [],
    isTemplate: (row as any).is_template ?? false,
    startTime: (row as any).start_time ?? null,
    endTime: (row as any).end_time ?? null,
    date: (row as any).event_date ?? null,
    capacity: (row as any).capacity ?? null,
    rsvp: (row as any).rsvp ?? null,
    ...ownersOf(row),
    macroStage: (row as any).macro_stage ?? null,
    status: resolveStatus(row, (row as any).series ?? null),
    overviewSummary: (row as any).overview_summary ?? null,
    lumaUrl: (row as any).luma_url ?? null,
    lumaEventId: (row as any).luma_event_id ?? null,
    gcalEventId: (row as any).gcal_event_id ?? null,
    gcalHtmlLink: (row as any).gcal_html_link ?? null,
    linearProjectId: (row as any).linear_project_id ?? null,
    linearProjectUrl: (row as any).linear_project_url ?? null,
    coverImageUrl: (row as any).cover_image_url ?? null,
    lumaCoverUrl: (row as any).luma_cover_url ?? null,
    customCoverUrl: (row as any).custom_cover_url ?? null,
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

// ── Vendor candidates ───────────────────────────────────────────────────────
export async function addCandidate(engagementId: string, vendorName: string, quoteAmount: number | null, link: string): Promise<VendorCandidate> {
  const id = genId('cand');
  const { error } = await supabase
    .from('engagement_candidate')
    .insert({ id, engagement_id: engagementId, vendor_name: vendorName, quote_amount: quoteAmount, link });
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
}
export async function setHeadcount(eventId: string, headcount: number | null): Promise<void> {
  const { error } = await supabase.from('event').update({ headcount }).eq('id', eventId);
  if (error) throw error;
}
export async function setEventBudgetTarget(eventId: string, target: number | null): Promise<void> {
  const { error } = await supabase.from('event').update({ event_budget_target: target }).eq('id', eventId);
  if (error) throw error;
}
/** Persist setup progress (completed step keys) and the overall complete flag together. */
export async function saveSetupState(eventId: string, progress: string[], complete: boolean): Promise<void> {
  const { error } = await supabase.from('event').update({ setup_progress: progress, setup_complete: complete }).eq('id', eventId);
  if (error) throw error;
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
  return { id, title: fields.title, phase: fields.phase, ownerRole: fields.ownerRole, dueDate: fields.dueDate, offsetStart: fields.offsetStart ?? null, offsetEnd: fields.offsetEnd ?? null, status: 'Todo', linearIssueId: null, linearIssueUrl: null, locked: fields.locked ?? false };
}
export async function setDeliverableStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase.from('deliverable').update({ status }).eq('id', id);
  if (error) throw error;
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
