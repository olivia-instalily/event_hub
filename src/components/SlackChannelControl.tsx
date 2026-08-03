import { useEffect, useRef, useState } from "react";
import { Plus, X, Loader2 } from "lucide-react";
import { slugifyChannel } from "../lib/slackChannel";
import { listSlackChannels, linkSlackChannel, unlinkSlackChannel, linkSeriesSlackChannel, unlinkSeriesSlackChannel, runSlackScrape, runSeriesScrape } from "../lib/db";

// Official 4-colour Slack mark, so the control reads as Slack rather than a generic button.
function SlackLogo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 122.8 122.8" className={className} aria-hidden="true">
      <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#E01E5A"/>
      <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36C5F0"/>
      <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2EB67D"/>
      <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ECB22E"/>
    </svg>
  );
}

// Links an event OR a series to a Slack channel. Pass seriesId for the series (shared-push) case;
// otherwise eventId. The picker/create UI is identical — only the link target differs.
export function SlackChannelControl({ eventId, seriesId, title, slackChannel, onChange }: { eventId?: string; seriesId?: string; title: string; slackChannel: string | null; onChange: () => void }) {
  const doLink = (arg: { channelId: string } | { create: { name: string } }) =>
    seriesId ? linkSeriesSlackChannel(seriesId, arg) : linkSlackChannel(eventId!, arg);
  const doUnlink = () => (seriesId ? unlinkSeriesSlackChannel(seriesId) : unlinkSlackChannel(eventId!));
  const doScrape = () => (seriesId ? runSeriesScrape(seriesId) : runSlackScrape(eventId!));
  const [processing, setProcessing] = useState(false); // first parse of a just-linked channel (background)
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

  const run = async (fn: () => Promise<{ id?: string; skipped?: string[] } | void>) => {
    setBusy(true); setErr(null);
    try {
      const r = await fn();
      setOpen(false); onChange();
      if (r && "skipped" in r && r.skipped?.length) alert(`Couldn't add to Slack (not found by email): ${r.skipped.join(", ")}`);
      // A link (not an unlink) returns an id → kick the first parse now and show it running in the background.
      if (r && "id" in r && r.id) {
        setProcessing(true);
        try { await doScrape(); } catch { /* ignore — the page's on-open scrape will retry */ }
        setProcessing(false);
        onChange();
      }
    } catch (e) {
      const m = (e as Error).message;
      setErr(
        m === "name_taken" ? "That channel name is taken — try another."
        : m === "private_needs_invite" ? "That's a private channel — invite the bot to it in Slack first, then pick it."
        : m,
      );
    } finally { setBusy(false); }
  };

  if (slackChannel) {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-gray-300 pl-2.5 pr-1.5 py-1" onClick={(e) => e.stopPropagation()}>
        <a href={`https://slack.com/app_redirect?channel=${slackChannel}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-gray-700 hover:text-gray-900">
          <SlackLogo /> #{linkedName ?? "channel"}
        </a>
        {processing && (
          <span className="inline-flex items-center gap-1 text-[11px] text-violet-600" title="Reading the channel — captures will appear shortly">
            <Loader2 className="w-3 h-3 animate-spin" /> reading…
          </span>
        )}
        <button onClick={() => run(doUnlink)} disabled={processing} title="Unlink" className="p-0.5 text-gray-400 hover:text-red-600 disabled:opacity-40"><X className="w-3.5 h-3.5" /></button>
      </span>
    );
  }

  const filtered = channels.filter((c) => c.name.includes(q.toLowerCase()));
  return (
    <div className="relative inline-block" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-900 border border-gray-300 rounded-lg px-2.5 py-1 hover:bg-gray-50 transition-colors">
        <SlackLogo /> + Channel
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-72 rounded-xl border border-border bg-white shadow-xl p-3 space-y-3">
          <div>
            <div className="text-[12px] text-gray-500 mb-1">Create a channel</div>
            <div className="flex items-center gap-1">
              <span className="text-gray-400">#</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 px-2 py-1 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              <button disabled={busy || !name.trim()} onClick={() => run(() => doLink({ create: { name: name.trim() } }))} className="inline-flex items-center gap-1 px-2 py-1 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50">
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
                  <button disabled={busy} onClick={() => run(() => doLink({ channelId: c.id }))} className="w-full text-left px-2 py-1 rounded text-sm hover:bg-gray-100">#{c.name}</button>
                </li>
              ))}
              {filtered.length === 0 && <li className="px-2 py-1 text-[13px] text-gray-400">No matching channels.</li>}
            </ul>
          </div>
          <p className="text-[11px] text-gray-400 leading-snug">Don't see a private channel? <code className="text-gray-500">/invite @eventhub</code> to any channel in Slack to allow pairing it, then reopen this.</p>
          {err && <p className="text-[12px] text-red-600">{err}</p>}
        </div>
      )}
    </div>
  );
}
