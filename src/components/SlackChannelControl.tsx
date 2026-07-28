import { useEffect, useRef, useState } from "react";
import { Hash, Plus, X, ExternalLink, Loader2 } from "lucide-react";
import { slugifyChannel } from "../lib/slackChannel";
import { listSlackChannels, linkSlackChannel, unlinkSlackChannel } from "../lib/db";

export function SlackChannelControl({ eventId, title, slackChannel, onChange }: { eventId: string; title: string; slackChannel: string | null; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => { if (open) { setName(slugifyChannel(title)); setErr(null); listSlackChannels().then(setChannels).catch(() => setChannels([])); } }, [open, title]);
  // Keep the linked-state name resolvable even before the popover is opened.
  useEffect(() => { if (slackChannel && channels.length === 0) listSlackChannels().then(setChannels).catch(() => {}); }, [slackChannel, channels.length]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const linkedName = channels.find((c) => c.id === slackChannel)?.name;

  const run = async (fn: () => Promise<{ skipped?: string[] } | void>) => {
    setBusy(true); setErr(null);
    try {
      const r = await fn();
      setOpen(false); onChange();
      if (r && "skipped" in r && r.skipped?.length) alert(`Couldn't add to Slack (not found by email): ${r.skipped.join(", ")}`);
    } catch (e) {
      const m = (e as Error).message;
      setErr(m === "name_taken" ? "That channel name is taken — try another." : m);
    } finally { setBusy(false); }
  };

  if (slackChannel) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-gray-600" onClick={(e) => e.stopPropagation()}>
        <a href={`https://slack.com/app_redirect?channel=${slackChannel}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-purple-700 hover:underline">
          <Hash className="w-3.5 h-3.5" />{linkedName ?? "slack channel"}<ExternalLink className="w-3 h-3" />
        </a>
        <button onClick={() => run(() => unlinkSlackChannel(eventId))} title="Unlink" className="p-0.5 text-gray-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
      </span>
    );
  }

  const filtered = channels.filter((c) => c.name.includes(q.toLowerCase()));
  return (
    <div className="relative inline-block" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg px-2.5 py-1 hover:bg-gray-50 transition-colors">
        <Hash className="w-4 h-4" /> Link Slack
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-72 rounded-xl border border-border bg-white shadow-xl p-3 space-y-3">
          <div>
            <div className="text-[12px] text-gray-500 mb-1">Create a channel</div>
            <div className="flex items-center gap-1">
              <span className="text-gray-400">#</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 px-2 py-1 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              <button disabled={busy || !name.trim()} onClick={() => run(() => linkSlackChannel(eventId, { create: { name: name.trim() } }))} className="inline-flex items-center gap-1 px-2 py-1 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <div className="text-[12px] text-gray-500 mb-1">Or pick an existing one</div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search channels…" className="w-full px-2 py-1 border border-border rounded text-sm mb-1 focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <ul className="max-h-40 overflow-auto">
              {filtered.map((c) => (
                <li key={c.id}>
                  <button disabled={busy} onClick={() => run(() => linkSlackChannel(eventId, { channelId: c.id }))} className="w-full text-left px-2 py-1 rounded text-sm hover:bg-gray-100">#{c.name}</button>
                </li>
              ))}
              {filtered.length === 0 && <li className="px-2 py-1 text-[13px] text-gray-400">No channels the bot is in.</li>}
            </ul>
          </div>
          {err && <p className="text-[12px] text-red-600">{err}</p>}
        </div>
      )}
    </div>
  );
}
