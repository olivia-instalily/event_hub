// Batch-sign private document keys into short-lived V4 signed GCS URLs (read). The private docs
// bucket is not public, so stored keys are only reachable through these time-limited URLs.
// Signing uses the runtime service account via IAM (no key file) — it needs the
// iam.serviceAccountTokenCreator role on itself (granted at setup). Prod-only, no Deno twin.
import { Request, Response } from 'express';
import { Storage } from '@google-cloud/storage';

const storage = new Storage();
const DOCS_BUCKET = process.env.GCS_DOCS_BUCKET;
const TTL_MS = 3600 * 1000; // 1 hour

export async function handler(req: Request, res: Response) {
  try {
    const { paths } = req.body ?? {};
    if (!Array.isArray(paths)) { res.status(400).json({ error: 'paths (string[]) required' }); return; }
    if (!DOCS_BUCKET) { res.status(500).json({ error: 'GCS_DOCS_BUCKET not configured' }); return; }

    const bucket = storage.bucket(DOCS_BUCKET);
    const urls: { path: string; url: string }[] = [];
    for (const p of paths) {
      if (typeof p !== 'string' || !p) continue;
      try {
        const [url] = await bucket.file(p).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + TTL_MS });
        urls.push({ path: p, url });
      } catch (e) {
        // A missing/unsignable object is skipped, not fatal — the caller maps only what came back.
        console.error(JSON.stringify({ fn: 'storage-sign', path: p, error: String((e as Error)?.message ?? e) }));
      }
    }
    res.json({ urls });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'storage-sign', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
