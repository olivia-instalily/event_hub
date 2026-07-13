import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Users, Plus, X, Search, Check, UserPlus } from "lucide-react";
import { useProfile, initials } from "../lib/profile";
import { setEventStaffRoles, setRoleAssignments, type Profile } from "../lib/db";

// Staffing = a list of roles, each of which can be filled by an actual person. Assignees are
// picked from the app's profiles, limited to teammates (an @instalily.ai email). The role list
// persists to event.staff_roles; the role→person map persists to event.role_assignments (a name
// string per role, matching what the settle flow and recap already read).

const INSTALILY = "@instalily.ai";

type Pos = { left: number; top?: number; bottom?: number; maxHeight: number; width: number };
function computePos(el: HTMLElement | null, width: number, desired: number): Pos | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
  const below = window.innerHeight - r.bottom - 8;
  const above = r.top - 8;
  if (below < desired && above > below) return { left, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(desired, above), width };
  return { left, top: r.bottom + 4, maxHeight: Math.min(desired, below), width };
}

// Profiles store color as a Tailwind class ("bg-blue-500") or a hex ("#3b82f6", SSO-created). A hex
// isn't a valid class, so render it via inline style — otherwise the circle comes out invisible.
function avatarColor(color: string | null): { cls: string; style?: { backgroundColor: string } } {
  const raw = color?.trim();
  if (raw?.startsWith("#")) return { cls: "", style: { backgroundColor: raw } };
  return { cls: raw || "bg-gray-400" };
}

function Avatar({ name, color }: { name: string; color: string | null }) {
  const { cls, style } = avatarColor(color);
  return (
    <span style={style} className={`w-5 h-5 rounded-full text-white text-[13px] font-medium flex items-center justify-center shrink-0 ${cls}`}>
      {initials(name)}
    </span>
  );
}

// Single-select assignee dropdown for one role. Opens in a portal so the card never clips it.
// Assignees are picked from accounts (profiles) only — no free-text. Exported so the settle flow
// reuses the exact same control for "who filled this role."
export function AssigneePicker({ team, current, onPick, disabled = false }: {
  team: Profile[];
  current: string | null;         // currently-assigned person's name, if any
  onPick: (name: string | null) => void;
  disabled?: boolean;             // read-only (e.g. once the event is settled)
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  const assigned = current ? team.find((p) => p.name === current) ?? null : null;
  const q = query.trim().toLowerCase();
  const filtered = team.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q));

  useLayoutEffect(() => { if (open) setPos(computePos(btnRef.current, 240, 300)); }, [open]);
  useEffect(() => {
    if (!open) return;
    const reposition = () => setPos(computePos(btnRef.current, 240, 300));
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false); setQuery("");
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setQuery(""); } };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className={`inline-flex items-center gap-1.5 rounded-full border px-1.5 py-0.5 text-sm transition-colors disabled:cursor-default disabled:opacity-70 ${assigned ? "border-gray-200 hover:bg-gray-50" : "border-dashed border-gray-300 text-gray-400 hover:bg-gray-50"}`}
      >
        {assigned ? (
          <><Avatar name={assigned.name} color={assigned.color} /> <span className="text-gray-800">{assigned.name}</span></>
        ) : current ? (
          // Assigned to a name that isn't (or is no longer) a profile — still show it.
          <><span className="w-5 h-5 rounded-full bg-gray-400 text-white text-[13px] font-medium flex items-center justify-center shrink-0">{initials(current)}</span> <span className="text-gray-800">{current}</span></>
        ) : (
          <><UserPlus className="w-3.5 h-3.5" /> Assign</>
        )}
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight }}
          className="z-50 bg-white border border-border rounded-lg shadow-lg overflow-hidden flex flex-col"
        >
          <div className="p-1 border-b border-gray-100 relative shrink-0">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search teammates…" className="w-full pl-7 pr-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <div className="overflow-y-auto p-1 flex-1 min-h-0">
            {current && (
              <button onClick={() => { onPick(null); setOpen(false); setQuery(""); }} className="flex items-center gap-2 w-full text-left px-2 py-1 rounded hover:bg-gray-50 text-sm text-gray-500">
                <span className="w-5 h-5 rounded-full border border-dashed border-gray-300 flex items-center justify-center"><X className="w-3 h-3 text-gray-400" /></span>
                Unassign
              </button>
            )}
            {team.length === 0 && <p className="px-2 py-2 text-sm text-gray-400 inline-flex items-center gap-1"><Users className="w-4 h-4" /> No @instalily.ai profiles yet.</p>}
            {filtered.map((p) => (
              <button key={p.id} onClick={() => { onPick(p.name); setOpen(false); setQuery(""); }} className="flex items-center gap-2 w-full text-left px-2 py-1 rounded hover:bg-gray-50 text-sm">
                <Avatar name={p.name} color={p.color} />
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{p.name}</span>
                  {p.email && <span className="block text-[13px] text-gray-400 truncate">{p.email}</span>}
                </span>
                {current === p.name && <Check className="w-4 h-4 text-gray-700 shrink-0" />}
              </button>
            ))}
            {filtered.length === 0 && team.length > 0 && <p className="px-2 py-2 text-[15px] text-gray-400">No match.</p>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export function StaffingEditor({ eventId, initialRoles, initialAssignments, defaultAssignee }: {
  eventId: string;
  initialRoles: string[];
  initialAssignments: Record<string, string>;
  defaultAssignee?: string | null; // new roles default to this person (the event's creator/owner)
}) {
  const { profiles } = useProfile();
  const team = profiles.filter((p) => (p.email ?? "").toLowerCase().endsWith(INSTALILY));
  const [roles, setRoles] = useState<string[]>(initialRoles);
  const [assigns, setAssigns] = useState<Record<string, string>>(initialAssignments);
  const [draft, setDraft] = useState("");

  const saveRoles = (next: string[]) => { setRoles(next); setEventStaffRoles(eventId, next).catch(() => {}); };
  const saveAssigns = (next: Record<string, string>) => { setAssigns(next); setRoleAssignments(eventId, next).catch(() => {}); };

  const addRole = () => {
    const t = draft.trim();
    if (!t || roles.some((r) => r.toLowerCase() === t.toLowerCase())) { setDraft(""); return; }
    saveRoles([...roles, t]);
    // Default the new role to the event's creator/owner — reassignable from the picker.
    if (defaultAssignee) saveAssigns({ ...assigns, [t]: defaultAssignee });
    setDraft("");
  };
  const removeRole = (role: string) => {
    saveRoles(roles.filter((r) => r !== role));
    if (role in assigns) { const { [role]: _drop, ...rest } = assigns; saveAssigns(rest); }
  };
  const assign = (role: string, name: string | null) => {
    const next = { ...assigns };
    if (name) next[role] = name; else delete next[role];
    saveAssigns(next);
  };

  return (
    <div className="bg-white rounded-2xl border border-border p-5">
      <h3 className="font-medium mb-3">Staffing</h3>
      {roles.length === 0 && <p className="text-sm text-gray-400 mb-3">No roles yet.</p>}
      {roles.length > 0 && (
        <ul className="divide-y divide-gray-100 mb-3">
          {roles.map((role) => (
            <li key={role} className="flex items-center gap-3 py-2">
              <Users className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="text-sm text-gray-800 flex-1 min-w-0 truncate">{role}</span>
              <AssigneePicker team={team} current={assigns[role] ?? null} onPick={(name) => assign(role, name)} />
              <button onClick={() => removeRole(role)} className="text-gray-300 hover:text-red-600 shrink-0" aria-label={`Remove ${role}`}><X className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addRole(); }} placeholder="Add a role (e.g. photographer)" className="flex-1 px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
        <button onClick={addRole} disabled={!draft.trim()} className="text-[15px] text-gray-500 hover:text-gray-900 disabled:opacity-40 inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Add role</button>
      </div>
    </div>
  );
}
