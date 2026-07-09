// DUAL-MAINTAINED: any changes here must also be made in
// supabase/functions/greenhouse-sync/index.ts
import { Request, Response } from 'express';

type Status = 'applied' | 'in_pipeline' | 'hired' | 'none';

function deriveStatus(candidate: any): Status {
  const apps: any[] = Array.isArray(candidate?.applications) ? candidate.applications : [];
  if (apps.length === 0) return 'none';
  const s = (a: any) => String(a?.status ?? '').toLowerCase();
  if (apps.some((a) => s(a) === 'hired' || s(a) === 'converted')) return 'hired';
  if (apps.some((a) => s(a) === 'active')) return 'in_pipeline';
  return 'applied';
}

export async function handler(req: Request, res: Response) {
  try {
    const { emails } = req.body;
    const list: string[] = Array.isArray(emails) ? emails.map((e: any) => String(e).trim().toLowerCase()).filter(Boolean) : [];
    if (list.length === 0) { res.json({ configured: true, matches: [] }); return; }

    const apiKey = process.env.GREENHOUSE_API_KEY;
    if (!apiKey) { res.json({ error: 'not configured', configured: false, matches: [] }); return; }

    const auth = 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');
    const matches: { email: string; candidateId: string; status: Status }[] = [];
    const unique = Array.from(new Set(list)).slice(0, 300);

    for (const email of unique) {
      try {
        const r = await fetch(`https://harvest.greenhouse.io/v1/candidates?email=${encodeURIComponent(email)}`, {
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
        });
        if (r.status === 401 || r.status === 403) { res.json({ error: 'Greenhouse auth failed — check the read-scoped Harvest key.', configured: false, matches: [] }); return; }
        if (r.status === 429) { await new Promise((resolve) => setTimeout(resolve, 1200)); continue; }
        if (!r.ok) continue;
        const cands = await r.json() as any;
        const c = Array.isArray(cands) ? cands[0] : null;
        if (c?.id != null) matches.push({ email, candidateId: String(c.id), status: deriveStatus(c) });
      } catch { /* skip this email */ }
    }
    res.json({ configured: true, matches });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'greenhouse-sync', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
