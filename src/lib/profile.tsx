import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { listProfiles, type Profile } from "./db";

// Initials (first letters of up to two words) for the avatar circle.
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Avatar circle colors (full literal classes for Tailwind's scanner).
export const PROFILE_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-rose-500",
  "bg-amber-500", "bg-teal-500", "bg-fuchsia-500", "bg-indigo-500",
];

interface ProfileCtx {
  profiles: Profile[];
  current: Profile | null;
  setCurrent: (id: string | null) => void;
  refresh: () => Promise<void>;
  locked: boolean;
}
const Ctx = createContext<ProfileCtx>({ profiles: [], current: null, setCurrent: () => {}, refresh: async () => {}, locked: false });
export const useProfile = () => useContext(Ctx);

const KEY = "currentProfileId";

export function ProfileProvider({ children, forcedProfileId = null }: { children: ReactNode; forcedProfileId?: string | null }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(() => forcedProfileId ?? localStorage.getItem(KEY));

  const refresh = async () => {
    const p = await listProfiles().catch(() => [] as Profile[]);
    setProfiles(p);
    setCurrentId((id) => forcedProfileId ?? (id && p.some((x) => x.id === id) ? id : p[0]?.id ?? null));
  };
  useEffect(() => { void refresh(); }, []);
  // Keep the current profile pinned to the signed-in user when forced.
  useEffect(() => { if (forcedProfileId) setCurrentId(forcedProfileId); }, [forcedProfileId]);

  const setCurrent = (id: string | null) => {
    if (forcedProfileId) return; // switching disabled when auth pins the identity
    setCurrentId(id);
    if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY);
  };

  const current = profiles.find((p) => p.id === currentId) ?? null;
  return <Ctx.Provider value={{ profiles, current, setCurrent, refresh, locked: !!forcedProfileId }}>{children}</Ctx.Provider>;
}
