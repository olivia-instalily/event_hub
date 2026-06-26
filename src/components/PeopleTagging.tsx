import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Star, Check, X, MessageSquarePlus, Inbox } from "lucide-react";
import {
  listEventTags, listAttendeesForEvent, tagPerson, untagLens, setPersonEventTagFields, confirmTag, dismissTag,
  type TagLens, type EventPersonTag, type PersonView,
} from "../lib/db";

// Tagging workspace = the People-page confirm-inbox + inline quick-tag over all attendees.
// Event-scoped ("tag the room" as a focused session). Proposals (debrief/Slack feeders, later)
// land in the inbox; manual tags apply immediately. Candidate lens is sensitive → admin-gated.

const LENS_LABEL: Record<TagLens, string> = { candidate: "Candidate", prospect: "Prospect", partner: "Partner" };
const LENS_CHIP: Record<TagLens, string> = {
  candidate: "bg-violet-600 border-violet-600",
  prospect: "bg-blue-600 border-blue-600",
  partner: "bg-emerald-600 border-emerald-600",
};
const SOURCE_LABEL: Record<string, string> = { debrief: "Debrief", slack: "Slack", manual: "Manual" };

// Event purpose orders which lens surfaces first; community events skip the funnel entirely.
function lensPlan(tag: string | null): { order: TagLens[]; community: boolean } {
  const t = (tag ?? "").toLowerCase();
  if (/run|coffee|community|social|meetup/.test(t)) return { order: ["prospect", "partner", "candidate"], community: true };
  if (/recruit|hire|talent|fireside|campus|career/.test(t)) return { order: ["candidate", "prospect", "partner"], community: false };
  if (/client|gtm|sales|customer|exec|briefing/.test(t)) return { order: ["prospect", "candidate", "partner"], community: false };
  if (/partner|sponsor|alliance/.test(t)) return { order: ["partner", "prospect", "candidate"], community: false };
  return { order: ["candidate", "prospect", "partner"], community: false };
}

export function TaggingWorkspace({ eventId, tag, isAdmin, currentProfileId }: {
  eventId: string; tag: string | null; isAdmin: boolean; currentProfileId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<EventPersonTag[]>([]);
  const [attendees, setAttendees] = useState<PersonView[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteFor, setNoteFor] = useState<string | null>(null); // attendeeId whose note is being edited
  const [noteDraft, setNoteDraft] = useState("");

  const plan = useMemo(() => lensPlan(tag), [tag]);
  // Candidate lens is access-gated; non-admins don't see/apply it.
  const lenses = plan.order.filter((l) => l !== "candidate" || isAdmin);

  const reload = () => {
    setLoading(true);
    Promise.all([listEventTags(eventId), listAttendeesForEvent(eventId)])
      .then(([t, a]) => { setTags(t); setAttendees(a); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(reload, [eventId]);

  // Group confirmed tags by attendee (for the roster) and split out proposals (for the inbox).
  const confirmed = tags.filter((t) => t.status === "confirmed");
  const proposals = tags.filter((t) => t.status === "proposed" && (isAdmin || t.lens !== "candidate"));
  const byAttendee = useMemo(() => {
    const m = new Map<string, EventPersonTag[]>();
    for (const t of confirmed) { const a = m.get(t.attendeeId) ?? []; a.push(t); m.set(t.attendeeId, a); }
    return m;
  }, [confirmed]);

  const flaggedCount = new Set(confirmed.filter((t) => t.priority).map((t) => t.attendeeId)).size;
  const taggedCount = byAttendee.size;

  // ── mutations (optimistic + persist) ──
  const toggleLens = async (attendeeId: string, lens: TagLens) => {
    const has = (byAttendee.get(attendeeId) ?? []).some((t) => t.lens === lens);
    try {
      if (has) { await untagLens(attendeeId, eventId, lens); }
      else { await tagPerson(attendeeId, eventId, lens, { createdBy: currentProfileId, source: "manual" }); }
      reload();
    } catch { /* ignore */ }
  };
  const toggleStar = async (attendeeId: string) => {
    const cur = byAttendee.get(attendeeId) ?? [];
    if (cur.length === 0) return;
    await setPersonEventTagFields(attendeeId, eventId, { priority: !cur.some((t) => t.priority) }).catch(() => {});
    reload();
  };
  const toggleFollow = async (attendeeId: string) => {
    const cur = byAttendee.get(attendeeId) ?? [];
    if (cur.length === 0) return;
    await setPersonEventTagFields(attendeeId, eventId, { followUp: !cur.some((t) => t.followUp) }).catch(() => {});
    reload();
  };
  const saveNote = async (attendeeId: string) => {
    await setPersonEventTagFields(attendeeId, eventId, { note: noteDraft.trim() || null }).catch(() => {});
    setNoteFor(null); setNoteDraft("");
    reload();
  };

  // Attendees ordered: already-tagged first, then checked-in, then name.
  const roster = [...attendees].filter((a) => !a.isAggregate).sort((a, b) =>
    Number(byAttendee.has(b.id)) - Number(byAttendee.has(a.id)) ||
    Number(!!b.checkedIn) - Number(!!a.checkedIn) ||
    (a.name ?? "").localeCompare(b.name ?? ""));

  return (
    <div className="mb-6 rounded-2xl border border-border bg-white overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left">
        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        <span className="font-medium">Tag the room</span>
        <span className="text-[13px] text-gray-500">{taggedCount} tagged · {flaggedCount} starred{proposals.length ? ` · ${proposals.length} to review` : ""}</span>
        <span className="ml-auto text-[12px] text-gray-400">early signals · who we think, not results</span>
      </button>

      {open && (
        <div className="border-t border-gray-100 p-4 space-y-5">
          {plan.community && (
            <p className="text-[13px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Community event — tagging is light here. Use it only for the rare standout; engagement matters more than triage.
            </p>
          )}

          {/* Confirm-inbox — debrief & Slack proposals (feeders land here later) */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Inbox className="w-4 h-4 text-gray-400" />
              <h4 className="font-medium text-sm">Proposals</h4>
              <span className="text-[12px] text-gray-400">propose-then-confirm · nothing's applied until you confirm</span>
            </div>
            {proposals.length === 0 ? (
              <p className="text-[13px] text-gray-400 px-1">No proposals yet. Debrief mentions and Slack <code className="text-gray-500">@eventhub</code> tags will arrive here for review.</p>
            ) : (
              <ul className="space-y-1.5">
                {proposals.map((p) => (
                  <li key={p.id} className="flex items-start gap-2 rounded-lg border border-gray-200 px-3 py-2">
                    <span className={`shrink-0 mt-0.5 text-[11px] text-white px-2 py-0.5 rounded-full ${LENS_CHIP[p.lens]}`}>{LENS_LABEL[p.lens]}</span>
                    <span className="flex-1 min-w-0">
                      <span className="text-sm text-gray-900">{p.name ?? p.email ?? "—"}</span>
                      {p.note && <span className="block text-[13px] text-gray-600">"{p.note}"</span>}
                      <span className="block text-[11px] text-gray-400">from {SOURCE_LABEL[p.source] ?? p.source}{p.sourceRef ? ` · ${p.sourceRef}` : ""}</span>
                    </span>
                    <button onClick={() => confirmTag(p.id).then(reload)} className="shrink-0 text-emerald-600 hover:text-emerald-800" title="Confirm"><Check className="w-4 h-4" /></button>
                    <button onClick={() => dismissTag(p.id).then(reload)} className="shrink-0 text-gray-300 hover:text-red-600" title="Dismiss"><X className="w-4 h-4" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Inline quick-tag over all attendees */}
          <div>
            <h4 className="font-medium text-sm mb-2">Attendees</h4>
            {loading ? <p className="text-[13px] text-gray-400">Loading…</p> : roster.length === 0 ? (
              <p className="text-[13px] text-gray-400">No attendees synced yet.</p>
            ) : (
              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
                {roster.slice(0, 40).map((a) => {
                  const cur = byAttendee.get(a.id) ?? [];
                  const starred = cur.some((t) => t.priority);
                  const following = cur.some((t) => t.followUp);
                  const note = cur.find((t) => t.note)?.note ?? null;
                  const rollup = cur[0]?.rollupEvents ?? 1;
                  return (
                    <div key={a.id} className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <button onClick={() => toggleStar(a.id)} disabled={cur.length === 0} className={`shrink-0 ${starred ? "text-amber-500" : "text-gray-300 hover:text-amber-400 disabled:hover:text-gray-200 disabled:text-gray-200"}`} title={cur.length === 0 ? "Tag a lens first" : "Priority"}>
                          <Star className="w-4 h-4" fill={starred ? "currentColor" : "none"} />
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900 truncate">{a.name ?? a.email ?? "—"}{a.checkedIn && <span className="ml-2 text-[11px] text-emerald-600">checked in</span>}{rollup > 1 && <span className="ml-2 text-[11px] text-violet-600">×{rollup} events</span>}</p>
                          {note && <p className="text-[12px] text-gray-500 truncate">"{note}"</p>}
                        </div>
                        <div className="shrink-0 flex items-center gap-1">
                          {lenses.map((l) => {
                            const on = cur.some((t) => t.lens === l);
                            return (
                              <button key={l} onClick={() => toggleLens(a.id, l)} className={`text-[12px] px-2 py-0.5 rounded-full border transition-colors ${on ? `text-white ${LENS_CHIP[l]}` : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                                {on ? LENS_LABEL[l] : `+ ${LENS_LABEL[l]}`}
                              </button>
                            );
                          })}
                          <button onClick={() => { setNoteFor(noteFor === a.id ? null : a.id); setNoteDraft(note ?? ""); }} disabled={cur.length === 0} className="text-gray-300 hover:text-gray-600 disabled:text-gray-200" title={cur.length === 0 ? "Tag a lens first" : "Add note"}><MessageSquarePlus className="w-4 h-4" /></button>
                          <button onClick={() => toggleFollow(a.id)} disabled={cur.length === 0} className={`text-[11px] px-2 py-0.5 rounded-full border ${following ? "border-amber-300 bg-amber-50 text-amber-700" : "border-gray-200 text-gray-400 hover:bg-gray-50 disabled:opacity-40"}`} title="Follow up">Follow up</button>
                        </div>
                      </div>
                      {noteFor === a.id && (
                        <div className="flex items-center gap-2 mt-2">
                          <input autoFocus value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveNote(a.id); }} placeholder="Why do they matter? (the note)" className="flex-1 px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                          <button onClick={() => saveNote(a.id)} className="text-sm text-gray-700 hover:text-black">Save</button>
                          <button onClick={() => setNoteFor(null)} className="text-sm text-gray-400 hover:text-gray-700">Cancel</button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {roster.length > 40 && <p className="px-3 py-2 text-[12px] text-gray-400">Showing first 40 — use search/filters above to find others.</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
