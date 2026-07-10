import { describe, it, expect } from "vitest";
import { validateGoogleClaims, signSession, verifySession, parseCookies } from "./auth-lib.js";

const CID = "test-client-id.apps.googleusercontent.com";

describe("validateGoogleClaims", () => {
  it("accepts a verified instalily account", () => {
    const r = validateGoogleClaims({ aud: CID, email: "Ada@instalily.ai", email_verified: true, hd: "instalily.ai", name: "Ada" }, CID);
    expect(r).toEqual({ ok: true, email: "ada@instalily.ai", name: "Ada" });
  });
  it("rejects a wrong audience", () => {
    expect(validateGoogleClaims({ aud: "other", email: "a@instalily.ai", email_verified: true }, CID).ok).toBe(false);
  });
  it("rejects an unverified email", () => {
    expect(validateGoogleClaims({ aud: CID, email: "a@instalily.ai", email_verified: false }, CID).ok).toBe(false);
  });
  it("rejects a non-instalily domain", () => {
    expect(validateGoogleClaims({ aud: CID, email: "a@gmail.com", email_verified: true }, CID).ok).toBe(false);
  });
  it("rejects a mismatched hd claim", () => {
    expect(validateGoogleClaims({ aud: CID, email: "a@instalily.ai", email_verified: true, hd: "evil.com" }, CID).ok).toBe(false);
  });
});

describe("session jwt", () => {
  it("round-trips claims and verifies signature", () => {
    const t = signSession({ role: "authenticated", email: "a@instalily.ai", profile_id: "prof-1" }, "secret", 3600);
    const p = verifySession(t, "secret");
    expect(p?.role).toBe("authenticated");
    expect(p?.profile_id).toBe("prof-1");
  });
  it("rejects a tampered token", () => {
    const t = signSession({ role: "authenticated" }, "secret", 3600);
    expect(verifySession(t + "x", "secret")).toBeNull();
    expect(verifySession(t, "wrong-secret")).toBeNull();
  });
  it("rejects an expired token", () => {
    const t = signSession({ role: "authenticated" }, "secret", -1);
    expect(verifySession(t, "secret")).toBeNull();
  });
});

describe("parseCookies", () => {
  it("parses a cookie header", () => {
    expect(parseCookies("eh_session=abc.def; other=1")).toEqual({ eh_session: "abc.def", other: "1" });
  });
  it("handles undefined", () => {
    expect(parseCookies(undefined)).toEqual({});
  });
});
