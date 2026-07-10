// cloud-functions/src/lib/slack.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

// Verify a Slack request signature over the RAW body. Reject if missing, stale (>5 min → replay),
// or mismatched. nowMs is injectable for tests.
export function verifySlackSignature(rawBody: string, timestamp: string | undefined, signature: string | undefined, secret: string, nowMs: number = Date.now()): boolean {
  if (!timestamp || !signature || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > 300) return false;
  const expected = 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
