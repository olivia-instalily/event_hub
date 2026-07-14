import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "../lib/auth";

// Loads Google Identity Services and renders the official "Sign in with Google" button. On
// credential, posts to /auth/google (the backend enforces the instalily.ai domain).
//
// Reliability: the functions server runs at min-instances 0, so the first request after idle can
// 502 while the container cold-starts. We retry /auth/config, the GIS script, and /auth/google with
// backoff so a cold start resolves itself instead of forcing the user to refresh repeatedly.
declare global { interface Window { google?: any } }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retry on network error or 5xx (cold start). Return immediately on 2xx OR a real 4xx (e.g. 403,
// which is a definitive "wrong domain" — retrying wouldn't help).
async function fetchRetry(url: string, opts?: RequestInit, tries = 5): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, opts);
      if (r.ok || (r.status >= 400 && r.status < 500)) return r;
      last = new Error(`HTTP ${r.status}`);
    } catch (e) { last = e; }
    await sleep(400 * (i + 1)); // 0.4s, 0.8s, 1.2s, …
  }
  throw last ?? new Error("request failed");
}

function loadGisOnce(): Promise<void> {
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
async function loadGisRetry(tries = 3): Promise<void> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { await loadGisOnce(); return; } catch (e) { last = e; await sleep(500 * (i + 1)); }
  }
  throw last ?? new Error("gis load failed");
}

export function LoginScreen() {
  const { refresh } = useAuth();
  const btnRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [signing, setSigning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const init = useCallback(async () => {
    setPhase("loading"); setErr(null);
    try {
      const cfg = await fetchRetry("/functions/v1/auth/config").then((r) => r.json());
      if (!cfg?.clientId) throw new Error("no client id");
      await loadGisRetry();
      if (!btnRef.current) return;
      btnRef.current.innerHTML = ""; // clear any prior render on retry
      window.google.accounts.id.initialize({
        client_id: cfg.clientId,
        hd: "instalily.ai",
        callback: async (resp: { credential: string }) => {
          setSigning(true); setErr(null);
          try {
            const r = await fetchRetry("/functions/v1/auth/google", {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ credential: resp.credential }),
            });
            if (r.ok) { await refresh(); return; }
            setErr(r.status === 403 ? "Use your @instalily.ai Google account." : "Sign-in failed. Please try again.");
          } catch {
            setErr("Couldn't reach the sign-in service — check your connection and try again.");
          } finally {
            setSigning(false);
          }
        },
      });
      window.google.accounts.id.renderButton(btnRef.current, { theme: "outline", size: "large", type: "standard", shape: "pill", width: 280 });
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [refresh]);

  useEffect(() => { void init(); }, [init]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-100 to-white px-4">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-white px-8 py-10 text-center shadow-md">
        <span className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-gray-50 ring-1 ring-gray-100">
          <img src="/logo.svg" alt="" className="h-11 w-auto" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">EventHub</h1>
        <p className="mt-1 mb-8 text-sm text-gray-500">Sign in with your Instalily account</p>

        <div className="flex min-h-[44px] flex-col items-center justify-center gap-3">
          {phase === "loading" && (
            <span className="inline-flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading sign-in…</span>
          )}
          {phase === "error" && (
            <button onClick={() => void init()} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
              <RefreshCw className="h-4 w-4" /> Try again
            </button>
          )}
          {/* Google renders its button into this node once ready (empty/0-height until then). */}
          <div ref={btnRef} className="flex justify-center" />
          {signing && (
            <span className="inline-flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Signing in…</span>
          )}
        </div>

        {err && <p className="mt-4 text-[13px] text-red-600">{err}</p>}
        {phase === "error" && !err && <p className="mt-3 text-[13px] text-gray-400">The sign-in service may be waking up. This usually clears in a few seconds.</p>}
      </div>
    </div>
  );
}
