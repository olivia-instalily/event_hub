import { supabase } from './supabase';
import { PAGE_PUBLIC_FIELDS } from './page';

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
  status: EventStatus;
  owner: string | null; // series.owning_team; null = not captured
  attendeeCount: number | null; // checked_in — the concrete attendance number
  rsvp: number | null;
  capacity: number | null;
  lumaEventId: string | null;
  lumaUrl: string | null;
  lumaName: string | null;
  coverImageUrl: string | null;
  coverPosition: string | null;
  labelIds: string[];
  macroStage: string | null; // set ⇒ an event we're actively planning (routes to the planning view)
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
    status: resolveStatus(row, series),
    owner: series?.owning_team ?? row.owning_team ?? null,
    attendeeCount: row.checked_in ?? null,
    rsvp: row.rsvp ?? null,
    capacity: row.capacity ?? null,
    lumaEventId: row.luma_event_id ?? null,
    lumaUrl: row.luma_url ?? null,
    lumaName: row.luma_name ?? null,
    coverImageUrl: row.cover_image_url ?? null,
    coverPosition: row.cover_position ?? null,
    labelIds: (row.event_label ?? []).map((l: any) => l.label_id),
    macroStage: row.macro_stage ?? null,
  };
}

/** Update an event's tags. Direct client write — no secret, low-stakes field. */
export async function updateEventTags(eventId: string, tags: string[]): Promise<void> {
  const { error } = await supabase.from('event').update({ tags }).eq('id', eventId);
  if (error) throw error;
}

/** Set the manual status override (future | in-process | past). */
export async function updateEventStatus(eventId: string, status: EventStatus): Promise<void> {
  const { error } = await supabase.from('event').update({ status }).eq('id', eventId);
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
}): Promise<string> {
  const eventId = newId('evt');
  const { error: eErr } = await supabase.from('event').insert({
    id: eventId, name: input.name, event_date: input.date, location: input.location,
    tags: input.tags, macro_stage: 'Planning',
  });
  if (eErr) throw eErr;

  const engRows = input.template.vendorCategories.map((cat) => ({ id: newId('eng'), event_id: eventId, category: cat, stage: 'Sourced' }));
  if (engRows.length) { const { error } = await supabase.from('engagement').insert(engRows); if (error) throw error; }

  const budgetId = newId('bud');
  const { error: bErr } = await supabase.from('budget').insert({ id: budgetId, event_id: eventId, currency: 'USD' });
  if (bErr) throw bErr;
  const lineRows = input.template.budgetLines.map((l) => ({ id: newId('bl'), budget_id: budgetId, label: l.label, confirmed_amount: l.estimate }));
  if (lineRows.length) { const { error } = await supabase.from('budget_line').insert(lineRows); if (error) throw error; }

  const delRows = input.template.progressCategories.map((p) => ({ id: newId('del'), event_id: eventId, title: p, phase: 'Planning', status: 'Todo' }));
  if (delRows.length) { const { error } = await supabase.from('deliverable').insert(delRows); if (error) throw error; }

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
  },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if ('name' in fields) patch.name = fields.name;
  if ('description' in fields) patch.description = fields.description;
  if ('coverPosition' in fields) patch.cover_position = fields.coverPosition;
  if ('format' in fields) patch.format = fields.format;
  if ('audience' in fields) patch.audience = fields.audience;
  if ('location' in fields) patch.location = fields.location;
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
export async function updateBudgetLine(id: string, fields: { label?: string; amount?: number | null }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if ('label' in fields) patch.label = fields.label;
  if ('amount' in fields) patch.confirmed_amount = fields.amount;
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
    .select('id, name, email, title, org, type, is_aggregate, count_est, note, school, city, industry, linkedin_url, photo_url, attendee_label ( label_id ), attendee_event ( event:event ( event_date ) )')
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
    };
  });
}

/** Attendees linked to one event, with their per-event role + Luma status. */
export async function listAttendeesForEvent(eventId: string): Promise<PersonView[]> {
  const { data, error } = await supabase
    .from('attendee_event')
    .select('role_at_event, registration_status, checked_in, attendee:attendee ( id, name, email, title, org, type, is_aggregate, count_est, note, school, city, industry, linkedin_url, photo_url, attendee_label ( label_id ), attendee_event ( count ) )')
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
  return {
    id, name: fields.name, email: fields.email ?? null, title: fields.title ?? null, org: fields.org ?? null,
    type: 'Unknown', isAggregate: false, countEst: null, note: null, school: null, city: null, industry: null,
    linkedinUrl: null, photoUrl: null, labelIds: [], eventsCount: 1, eventDates: [],
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

export async function updateEventCover(eventId: string, url: string | null): Promise<void> {
  const { error } = await supabase.from('event').update({ cover_image_url: url }).eq('id', eventId);
  if (error) throw error;
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
  fields: { note?: string | null; linkedinUrl?: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if ('note' in fields) patch.note = fields.note;
  if ('linkedinUrl' in fields) patch.linkedin_url = fields.linkedinUrl;
  const { error } = await supabase.from('attendee').update(patch).eq('id', id);
  if (error) throw error;
}

// ── Claude-generated planning template ──────────────────────────────────────
export interface GeneratedTemplate {
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

export async function listEvents(): Promise<EventListItem[]> {
  const { data, error } = await supabase
    .from('event')
    .select(
      'id, name, tag, tags, format, location, office, event_date, rsvp, capacity, checked_in, macro_stage, owning_team, status, series_id, luma_event_id, luma_url, luma_name, cover_image_url, cover_position, event_label ( label_id ), series:event_series ( id, name, type, status, owning_team )',
    )
    .order('id');
  if (error) throw error;
  return (data ?? []).map(toListItem);
}

export async function getEventDetail(id: string): Promise<EventDetail | null> {
  const { data: row, error } = await supabase
    .from('event')
    .select(
      'id, name, tag, tags, description, format, location, office, event_date, rsvp, capacity, checked_in, waitlist_admitted, actual_attendance_note, audience, notes, macro_stage, owning_team, status, series_id, cover_image_url, cover_position, ' +
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
}
export interface BudgetLineTracker {
  id: string;
  label: string | null;
  confirmedAmount: number | null;
  paymentStatus: 'paid' | 'pending' | null;
  docUrl: string | null;
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
  status: string | null;
  linearIssueId: string | null;
}
export interface CarriedLesson {
  body: string;
  sourceEventName: string;
  why: string;
}
export interface EventPlanning {
  id: string;
  title: string;
  tags: string[];
  location: string | null;
  date: string | null;
  capacity: number | null;
  rsvp: number | null;
  owner: string | null;
  macroStage: string | null;
  status: EventStatus;
  overviewSummary: string | null;
  lumaUrl: string | null;
  lumaEventId: string | null;
  coverImageUrl: string | null;
  page: PageState;
  pageDraft: PageDraft | null;
  engagements: EngagementWithCandidates[];
  budget: PlanningBudget | null;
  deliverables: Deliverable[];
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
export interface AgendaItem { time: string; title: string; desc: string }
export interface PageDraft {
  theme: { font: PageFont; accent: string; bgImageUrl: string | null; bgColor: string | null; scrollAnim: boolean };
  hero: { headline: string; subhead: string; coverUrl: string | null };
  about: { body: string };
  agenda: { title: string; items: AgendaItem[] };
  speakers: { title: string }; // the list is data-bound (listEventSpeakers)
  details: { rsvpLabel: string };
  gallery: { images: string[] };
  logos: { images: string[] };
  closing: { headline: string; body: string; rsvpLabel: string };
  order: string[];                 // body-section order (hero is fixed on top)
  visible: Record<string, boolean>;
}
export function defaultPageDraft(): PageDraft {
  return {
    theme: { font: 'inter', accent: '#111827', bgImageUrl: null, bgColor: null, scrollAnim: true },
    hero: { headline: '', subhead: '', coverUrl: null },
    about: { body: '' },
    agenda: { title: 'Agenda', items: [] },
    speakers: { title: 'Speakers' },
    details: { rsvpLabel: 'RSVP' },
    gallery: { images: [] },
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
    .select('id, name, tags, location, office, event_date, capacity, rsvp, macro_stage, owning_team, status, overview_summary, luma_url, luma_event_id, page_ownership, repo_ref, last_deploy_status, preview_url, live_url, ejected_at, ejected_snapshot, page_draft, cover_image_url, series:event_series ( owning_team, status )')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;

  const [{ data: engs }, { data: budgets }, { data: dels }] = await Promise.all([
    supabase
      .from('engagement')
      .select('id, category, stage, confirmed_amount, note, candidates:engagement_candidate ( id, vendor_id, vendor_name, quote_amount, is_selected, note, link, vendor:vendor ( name ) )')
      .eq('event_id', eventId)
      .order('id'),
    supabase
      .from('budget')
      .select('id, currency, target_amount, lines:budget_line ( id, label, confirmed_amount, payment_status, doc_url, linked_engagement )')
      .eq('event_id', eventId),
    supabase
      .from('deliverable')
      .select('id, title, phase, owner_role, resolved_due_date, status, linear_issue_id')
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
          paymentStatus: l.payment_status ?? null,
          docUrl: l.doc_url ?? null,
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
    status: d.status ?? null,
    linearIssueId: d.linear_issue_id ?? null,
  }));

  return {
    id: row.id,
    title: (row as any).name,
    tags: (row as any).tags ?? [],
    location: (row as any).location ?? (row as any).office ?? null,
    date: (row as any).event_date ?? null,
    capacity: (row as any).capacity ?? null,
    rsvp: (row as any).rsvp ?? null,
    owner: (row as any).owning_team ?? (row as any).series?.owning_team ?? null,
    macroStage: (row as any).macro_stage ?? null,
    status: resolveStatus(row, (row as any).series ?? null),
    overviewSummary: (row as any).overview_summary ?? null,
    lumaUrl: (row as any).luma_url ?? null,
    lumaEventId: (row as any).luma_event_id ?? null,
    coverImageUrl: (row as any).cover_image_url ?? null,
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
  };
}

// ── Macro stage ─────────────────────────────────────────────────────────────
export async function setMacroStage(eventId: string, stage: string): Promise<void> {
  const { error } = await supabase.from('event').update({ macro_stage: stage }).eq('id', eventId);
  if (error) throw error;
}

// ── Engagements (vendor decisions) ──────────────────────────────────────────
export async function addEngagement(eventId: string, category: string): Promise<EngagementWithCandidates> {
  const id = genId('eng');
  const { error } = await supabase.from('engagement').insert({ id, event_id: eventId, category, stage: 'Sourced' });
  if (error) throw error;
  return { id, category, stage: 'Sourced', confirmedAmount: null, note: null, candidates: [] };
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
  return { id, label, confirmedAmount: amount, paymentStatus: null, docUrl: null, linkedEngagement: null };
}
export async function setLinePaymentStatus(id: string, status: 'paid' | 'pending' | null): Promise<void> {
  const { error } = await supabase.from('budget_line').update({ payment_status: status }).eq('id', id);
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

// ── Deliverables ────────────────────────────────────────────────────────────
export async function addDeliverable(eventId: string, fields: { title: string; phase: string; ownerRole: string | null; dueDate: string | null }): Promise<Deliverable> {
  const id = genId('del');
  const { error } = await supabase.from('deliverable').insert({
    id, event_id: eventId, title: fields.title, phase: fields.phase, owner_role: fields.ownerRole, resolved_due_date: fields.dueDate, status: 'Todo',
  });
  if (error) throw error;
  return { id, title: fields.title, phase: fields.phase, ownerRole: fields.ownerRole, dueDate: fields.dueDate, status: 'Todo', linearIssueId: null };
}
export async function setDeliverableStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase.from('deliverable').update({ status }).eq('id', id);
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
  kind: 'contract' | 'complete' | 'note';
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
  return parts.join(" ");
}

/** Persist the Overview digest so it isn't regenerated on every view. */
export async function saveOverviewSummary(eventId: string, summary: string): Promise<void> {
  const { error } = await supabase.from('event').update({ overview_summary: summary }).eq('id', eventId);
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
