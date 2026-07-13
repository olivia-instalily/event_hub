import { useEffect, useState } from "react";
import { Shield, ShieldCheck, Pencil, Trash2, Search, Check, X, Lock } from "lucide-react";
import { useProfile, initials, PROFILE_COLORS } from "../lib/profile";
import { listProfiles, listEvents, updateProfile, deleteProfile, setProfileAdmin, type Profile } from "../lib/db";
import { ConfirmModal } from "./Modal";

// Admin-only view of everyone with a profile on the platform (SSO auto-creates a profile on first
// sign-in). Lets an admin rename, grant/revoke admin, and delete accounts.
//
// NOTE: authorization is UI-gated (shown only to is_admin), not enforced server-side — under the
// current gate-only model every signed-in @instalily.ai user shares the `authenticated` DB role, so
// the API doesn't distinguish admins. Real enforcement arrives with per-user RLS (deferred).

// Mirror ProfileSwitcher's avatar handling: color is a Tailwind class, a hex (SSO), or empty.
function avatarColor(color: string | null, name: string): { cls: string; style?: { backgroundColor: string } } {
  const raw = color?.trim();
  if (raw?.startsWith("#")) return { cls: "", style: { backgroundColor: raw } };
  if (raw) return { cls: raw };
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return { cls: PROFILE_COLORS[Math.abs(h) % PROFILE_COLORS.length] };
}

export function PeopleAdminPage() {
  const { current, refresh: refreshCtx } = useProfile();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [ownCounts, setOwnCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDel, setConfirmDel] = useState<Profile | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [ps, evs] = await Promise.all([listProfiles(), listEvents().catch(() => [])]);
      setProfiles(ps);
      const counts: Record<string, number> = {};
      for (const e of evs) for (const o of e.owners) counts[o.id] = (counts[o.id] ?? 0) + 1;
      setOwnCounts(counts);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // UI gate. (Server-side enforcement is deferred — see note at top.)
  if (current && !current.isAdmin) {
    return (
      <div className="max-w-3xl mx-auto py-20 flex flex-col items-center text-center text-gray-500">
        <Lock className="w-8 h-8 text-gray-300 mb-3" />
        <p className="font-medium text-gray-700">Admins only</p>
        <p className="text-sm mt-1">You don't have access to manage people. Ask an admin if you need it.</p>
      </div>
    );
  }

  const adminCount = profiles.filter((p) => p.isAdmin).length;
  const q = query.trim().toLowerCase();
  const shown = profiles.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q));

  const saveName = async (id: string) => {
    const n = editName.trim();
    if (n) await updateProfile(id, { name: n });
    setEditId(null);
    await load();
    await refreshCtx();
  };
  const toggleAdmin = async (p: Profile) => {
    setErr(null);
    if (p.isAdmin && adminCount <= 1) { setErr("Can't remove the last admin — grant someone else admin first."); return; }
    await setProfileAdmin(p.id, !p.isAdmin);
    await load();
    await refreshCtx();
  };
  const doDelete = async () => {
    if (!confirmDel) return;
    await deleteProfile(confirmDel.id);
    setConfirmDel(null);
    await load();
    await refreshCtx();
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <ShieldCheck className="w-6 h-6 text-gray-700" />
        <h1 className="text-2xl">People &amp; access</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">Everyone with a profile — created automatically when they first sign in. Rename, grant admin, or remove an account.</p>

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or email…" className="w-full rounded-lg border border-border pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
      </div>

      {err && <p className="text-sm text-red-600 mb-3">{err}</p>}

      {loading ? (
        <p className="text-gray-400 py-12 text-center">Loading…</p>
      ) : (
        <div className="rounded-xl border border-border divide-y divide-gray-100">
          {shown.map((p) => {
            const { cls, style } = avatarColor(p.color, p.name);
            const isSelf = current?.id === p.id;
            const owns = ownCounts[p.id] ?? 0;
            return (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                <span style={style} className={`w-9 h-9 rounded-full text-white text-sm font-medium flex items-center justify-center shrink-0 ${cls}`}>{initials(p.name)}</span>
                <div className="min-w-0 flex-1">
                  {editId === p.id ? (
                    <div className="flex items-center gap-2">
                      <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveName(p.id); if (e.key === "Escape") setEditId(null); }} className="px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                      <button onClick={() => saveName(p.id)} className="text-gray-600 hover:text-gray-900" aria-label="Save"><Check className="w-4 h-4" /></button>
                      <button onClick={() => setEditId(null)} className="text-gray-400 hover:text-gray-700" aria-label="Cancel"><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{p.name}</span>
                      {isSelf && <span className="text-[12px] text-gray-400">(you)</span>}
                      {p.isAdmin && <span className="inline-flex items-center gap-1 rounded-full bg-gray-900 px-2 py-0.5 text-[11px] text-white"><Shield className="w-3 h-3" /> Admin</span>}
                    </div>
                  )}
                  <div className="text-[13px] text-gray-500 truncate">{p.email ?? "no email"}{owns > 0 && <span className="text-gray-400"> · owns {owns} event{owns === 1 ? "" : "s"}</span>}</div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggleAdmin(p)} title={p.isAdmin ? "Revoke admin" : "Make admin"} className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[13px] ${p.isAdmin ? "border-gray-300 text-gray-700 hover:bg-gray-50" : "border-transparent text-gray-500 hover:bg-gray-50"}`}>
                    {p.isAdmin ? <><ShieldCheck className="w-3.5 h-3.5" /> Admin</> : <><Shield className="w-3.5 h-3.5" /> Make admin</>}
                  </button>
                  <button onClick={() => { setEditId(p.id); setEditName(p.name); }} className="p-2 text-gray-400 hover:text-gray-700" aria-label="Rename"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => setConfirmDel(p)} disabled={isSelf} title={isSelf ? "You can't delete your own account" : "Delete account"} className="p-2 text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-gray-400" aria-label="Delete"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            );
          })}
          {shown.length === 0 && <p className="px-4 py-8 text-center text-sm text-gray-400">No people match "{query}".</p>}
        </div>
      )}

      {confirmDel && (
        <ConfirmModal
          title="Delete this profile?"
          message={`Permanently remove ${confirmDel.name}${confirmDel.email ? ` (${confirmDel.email})` : ""} from EventHub.${(ownCounts[confirmDel.id] ?? 0) > 0 ? ` They're an owner on ${ownCounts[confirmDel.id]} event${ownCounts[confirmDel.id] === 1 ? "" : "s"} — those events will lose them as an owner.` : ""} If they sign in again, a fresh profile is created.`}
          confirmLabel="Delete"
          danger
          onConfirm={doDelete}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}
