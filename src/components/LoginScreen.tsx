import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";

// Loads the Google Identity Services script once and renders the official "Sign in with Google"
// button. On credential, posts to /auth/google; the backend enforces the instalily.ai domain.
declare global { interface Window { google?: any; } }

function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google sign-in"));
    document.head.appendChild(s);
  });
}

export function LoginScreen() {
  const { refresh } = useAuth();
  const btnRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await fetch("/functions/v1/auth/config").then((r) => r.json());
        await loadGis();
        if (cancelled || !btnRef.current || !cfg.clientId) return;
        window.google.accounts.id.initialize({
          client_id: cfg.clientId,
          hd: "instalily.ai",
          callback: async (resp: { credential: string }) => {
            setErr(null);
            const r = await fetch("/functions/v1/auth/google", {
              method: "POST", credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ credential: resp.credential }),
            });
            if (r.ok) { await refresh(); }
            else { const b = await r.json().catch(() => ({})); setErr(b.error === "not an instalily.ai account" ? "Use your @instalily.ai Google account." : "Sign-in failed. Try again."); }
          },
        });
        window.google.accounts.id.renderButton(btnRef.current, { theme: "outline", size: "large", type: "standard" });
      } catch { if (!cancelled) setErr("Couldn't load Google sign-in. Refresh to retry."); }
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white border border-border rounded-2xl shadow-sm px-8 py-10 w-full max-w-sm text-center">
        <h1 className="text-2xl mb-1">EventHub</h1>
        <p className="text-sm text-gray-500 mb-6">Sign in with your Instalily account.</p>
        <div ref={btnRef} className="flex justify-center" />
        {err && <p className="text-[13px] text-red-600 mt-4">{err}</p>}
      </div>
    </div>
  );
}
