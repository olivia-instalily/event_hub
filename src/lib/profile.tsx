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
}
const Ctx = createContext<ProfileCtx>({ profiles: [], current: null, setCurrent: () => {}, refresh: async () => {} });
export const useProfile = () => useContext(Ctx);

const KEY = "currentProfileId";

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(() => localStorage.getItem(KEY));

  const refresh = async () => {
    const p = await listProfiles().catch(() => [] as Profile[]);
    setProfiles(p);
    // If the stored current was deleted, fall back to the first profile.
    setCurrentId((id) => (id && p.some((x) => x.id === id) ? id : p[0]?.id ?? null));
  };
  useEffect(() => { void refresh(); }, []);

  const setCurrent = (id: string | null) => {
    setCurrentId(id);
    if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY);
  };

  const current = profiles.find((p) => p.id === currentId) ?? null;
  return <Ctx.Provider value={{ profiles, current, setCurrent, refresh }}>{children}</Ctx.Provider>;
}
