import { useState } from "react";
import { ChevronDown, Plus, Check, Trash2, X, Pencil, HelpCircle, LogOut, ShieldCheck } from "lucide-react";
import { useProfile, initials, PROFILE_COLORS } from "../lib/profile";
import { useAuth } from "../lib/auth";
import { createProfile, updateProfile, deleteProfile, type Profile } from "../lib/db";
import { CREW_ROLES, ROLE_LABEL, type CrewRole } from "../lib/campaign";

function Avatar({ p }: { p: Profile | null }) {
  const { cls, style } = avatarColor(p?.color ?? null, p?.name ?? null);
  return (
    <span style={style} className={`w-7 h-7 rounded-full text-white text-[15px] font-medium flex items-center justify-center shrink-0 ${cls}`}>
      {p ? initials(p.name) : "?"}
    </span>
  );
}

// Profiles store color two ways: a Tailwind class ("bg-blue-500", from client-created profiles)
// or a hex value ("#3b82f6", from SSO-created profiles in the auth function). A hex string isn't a
// valid class, so dropping it into className leaves the circle invisible — render hex via inline
// style instead. Empty/null falls back to a stable per-name color so a circle is never colorless.
function avatarColor(color: string | null, name: string | null): { cls: string; style?: { backgroundColor: string } } {
  const raw = color?.trim();
  if (raw?.startsWith("#")) return { cls: "", style: { backgroundColor: raw } };
  if (raw) return { cls: raw };
  return { cls: name ? colorFor(name) : "bg-gray-400" };
}

// Deterministic color pick from a name, so the same person always gets the same circle.
function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PROFILE_COLORS[Math.abs(h) % PROFILE_COLORS.length];
}

export function ProfileSwitcher({ onOpenTutorial, onOpenAdmin }: { onOpenTutorial?: () => void; onOpenAdmin?: () => void }) {
  const { profiles, current, setCurrent, refresh, locked } = useProfile();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [dept, setDept] = useState<CrewRole>("none"); // department, linked to the person list by email
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    const color = PROFILE_COLORS[profiles.length % PROFILE_COLORS.length];
    const p = await createProfile(n, email.trim() || null, color, dept);
    await refresh();
    setCurrent(p.id);
    setName(""); setEmail(""); setDept("none"); setAdding(false);
  };
  const saveEdit = async (id: string) => {
    const n = editName.trim();
    if (n) await updateProfile(id, { name: n });
    await refresh();
    setEditId(null);
  };
  const remove = async (id: string) => {
    await deleteProfile(id);
    if (current?.id === id) setCurrent(null);
    await refresh();
  };

  if (locked) {
    return (
      <div className="relative">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors">
          <Avatar p={current} />
          <span className="text-sm text-gray-700 max-w-[10rem] truncate">{current?.name ?? "…"}</span>
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <div className="absolute right-0 z-40 mt-1 w-48 bg-white border border-border rounded-lg shadow-lg p-1">
              {onOpenTutorial && (
                <button onClick={() => { setOpen(false); onOpenTutorial(); }} className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-gray-50 text-sm text-gray-700"><HelpCircle className="w-4 h-4" /> Tutorial</button>
              )}
              {onOpenAdmin && current?.isAdmin && (
                <button onClick={() => { setOpen(false); onOpenAdmin(); }} className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-gray-50 text-sm text-gray-700"><ShieldCheck className="w-4 h-4" /> People &amp; access</button>
              )}
              <button onClick={() => { setOpen(false); void signOut(); }} className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-gray-50 text-sm text-gray-700"><LogOut className="w-4 h-4" /> Sign out</button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors">
        <Avatar p={current} />
        <span className="text-sm text-gray-700 max-w-[10rem] truncate">{current?.name ?? "No profile"}</span>
        <ChevronDown className="w-4 h-4 text-gray-400" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => { setOpen(false); setAdding(false); setEditId(null); }} />
          <div className="absolute right-0 z-40 mt-1 w-72 bg-white border border-border rounded-lg shadow-lg p-1">
            <p className="px-2 py-1 text-[15px] text-gray-400 uppercase tracking-wide">Acting as</p>
            <div className="max-h-64 overflow-y-auto">
              {profiles.length === 0 && <p className="px-2 py-2 text-sm text-gray-400">No profiles yet — create one.</p>}
              {profiles.map((p) => (
                <div key={p.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 group">
                  {editId === p.id ? (
                    <>
                      <Avatar p={p} />
                      <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveEdit(p.id); }} className="flex-1 px-1 py-0.5 border border-gray-300 rounded text-sm focus:outline-none" />
                      <button onClick={() => saveEdit(p.id)} className="text-[15px] text-gray-600 hover:text-gray-900">Save</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setCurrent(p.id); setOpen(false); }} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                        <Avatar p={p} />
                        <span className="min-w-0">
                          <span className="block text-sm truncate">{p.name}</span>
                          {p.email && <span className="block text-[15px] text-gray-400 truncate">{p.email}</span>}
                        </span>
                      </button>
                      {current?.id === p.id && <Check className="w-4 h-4 text-gray-700 shrink-0" />}
                      <button onClick={() => { setEditId(p.id); setEditName(p.name); }} className="text-gray-300 hover:text-gray-700 opacity-0 group-hover:opacity-100" aria-label="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => remove(p.id)} className="text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100" aria-label="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="border-t border-gray-100 mt-1 pt-1">
              {adding ? (
                <div className="p-1 space-y-1">
                  <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                  <input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Email (links you to the person list)" className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                  <label className="block text-[12px] text-gray-500">Department
                    <select value={dept} onChange={(e) => setDept(e.target.value as CrewRole)} className="mt-0.5 w-full px-2 py-1 border border-gray-300 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-300">
                      {CREW_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  </label>
                  <div className="flex gap-2">
                    <button onClick={add} disabled={!name.trim()} className="px-3 py-1 bg-gray-200 rounded text-sm hover:bg-gray-300 disabled:opacity-50">Add</button>
                    <button onClick={() => { setAdding(false); setName(""); setEmail(""); setDept("none"); }} className="px-2 py-1 text-sm text-gray-500 hover:text-gray-900 inline-flex items-center gap-1"><X className="w-3.5 h-3.5" /> Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setAdding(true)} className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-gray-50 text-sm text-gray-700"><Plus className="w-4 h-4" /> Add profile</button>
              )}
            </div>

            {(onOpenTutorial || (onOpenAdmin && current?.isAdmin)) && (
              <div className="border-t border-gray-100 mt-1 pt-1">
                {onOpenTutorial && (
                  <button onClick={() => { setOpen(false); onOpenTutorial(); }} className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-gray-50 text-sm text-gray-700"><HelpCircle className="w-4 h-4" /> Tutorial</button>
                )}
                {onOpenAdmin && current?.isAdmin && (
                  <button onClick={() => { setOpen(false); onOpenAdmin(); }} className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-gray-50 text-sm text-gray-700"><ShieldCheck className="w-4 h-4" /> People &amp; access</button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
