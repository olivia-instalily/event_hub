import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { proxiedBackend } from "./supabase";

export interface AuthUser { profileId: string; email: string; name: string; }
type Status = "loading" | "authed" | "unauthed";
interface AuthCtx { status: Status; user: AuthUser | null; refresh: () => Promise<void>; signOut: () => Promise<void>; }

const Ctx = createContext<AuthCtx>({ status: "loading", user: null, refresh: async () => {}, signOut: async () => {} });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  const refresh = async () => {
    // Local dev talks to the Supabase stack directly (no Caddy/cookie), so skip the gate.
    if (!proxiedBackend) {
      setUser({ profileId: "", email: "dev@instalily.ai", name: "Dev" });
      setStatus("authed");
      return;
    }
    try {
      const res = await fetch("/functions/v1/auth/me", { credentials: "same-origin" });
      if (res.ok) { setUser((await res.json()) as AuthUser); setStatus("authed"); }
      else { setUser(null); setStatus("unauthed"); }
    } catch { setUser(null); setStatus("unauthed"); }
  };

  useEffect(() => { void refresh(); }, []);

  const signOut = async () => {
    await fetch("/functions/v1/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    setUser(null);
    setStatus("unauthed");
  };

  return <Ctx.Provider value={{ status, user, refresh, signOut }}>{children}</Ctx.Provider>;
}
