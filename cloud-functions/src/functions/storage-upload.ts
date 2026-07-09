// Upload a file to Google Cloud Storage. The deployed app has no Supabase Storage, so the client
// (src/lib/db.ts uploadAttachment/uploadDocument) posts files here in prod instead.
//   visibility 'public'  → public bucket (cover images / attachments) → returns a public URL
//   visibility 'private' → docs bucket (sensitive briefs/budgets)     → returns the object key
// (Local dev still uses Supabase Storage directly; this function is prod-only, no Deno twin.)
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Storage } from '@google-cloud/storage';

const storage = new Storage();
const PUBLIC_BUCKET = process.env.GCS_PUBLIC_BUCKET;
const DOCS_BUCKET = process.env.GCS_DOCS_BUCKET;

export async function handler(req: Request, res: Response) {
  try {
    const { name, contentType, dataBase64, visibility } = req.body ?? {};
    if (!name || !dataBase64) { res.status(400).json({ error: 'name and dataBase64 required' }); return; }
    const isPublic = visibility === 'public';
    const bucketName = isPublic ? PUBLIC_BUCKET : DOCS_BUCKET;
    if (!bucketName) { res.status(500).json({ error: `${isPublic ? 'GCS_PUBLIC_BUCKET' : 'GCS_DOCS_BUCKET'} not configured` }); return; }

    const buf = Buffer.from(String(dataBase64), 'base64');
    const dot = String(name).lastIndexOf('.');
    const ext = dot >= 0 ? String(name).slice(dot) : '';
    const key = `${isPublic ? 'att' : 'doc'}-${randomUUID()}${ext}`;

    await storage.bucket(bucketName).file(key).save(buf, { contentType: contentType || undefined, resumable: false });

    // Public bucket objects are world-readable (bucket-level allUsers:objectViewer) → direct URL.
    // Private objects return only their key; the client turns it into a signed URL via storage-sign.
    if (isPublic) res.json({ url: `https://storage.googleapis.com/${bucketName}/${key}` });
    else res.json({ path: key });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'storage-upload', error: String((e as Error)?.message ?? e) }));
    res.status(500).json({ error: String((e as Error)?.message ?? e) });
  }
}
