// tests/slackSignature.test.ts
import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifySlackSignature } from "../cloud-functions/src/lib/slack";

const SECRET = "test_signing_secret";
const sign = (body: string, ts: string) => "v0=" + createHmac("sha256", SECRET).update(`v0:${ts}:${body}`).digest("hex");

describe("verifySlackSignature", () => {
  const now = 1_000_000_000_000; // fixed ms
  const ts = String(Math.floor(now / 1000));
  const body = "payload=%7B%22type%22%3A%22block_actions%22%7D";

  it("accepts a valid, fresh signature", () => {
    expect(verifySlackSignature(body, ts, sign(body, ts), SECRET, now)).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifySlackSignature(body + "x", ts, sign(body, ts), SECRET, now)).toBe(false);
  });
  it("rejects a stale timestamp (>5 min)", () => {
    const old = String(Math.floor(now / 1000) - 400);
    expect(verifySlackSignature(body, old, sign(body, old), SECRET, now)).toBe(false);
  });
  it("rejects missing signature/timestamp/secret", () => {
    expect(verifySlackSignature(body, undefined, sign(body, ts), SECRET, now)).toBe(false);
    expect(verifySlackSignature(body, ts, undefined, SECRET, now)).toBe(false);
    expect(verifySlackSignature(body, ts, sign(body, ts), "", now)).toBe(false);
  });
});
