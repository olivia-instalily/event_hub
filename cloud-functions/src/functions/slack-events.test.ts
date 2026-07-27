import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { routeSlackEvent } from "./slack-events.js";

const SECRET = "test_signing_secret";
const now = 1_000_000_000_000;
const ts = String(Math.floor(now / 1000));
const sign = (body: string) => "v0=" + createHmac("sha256", SECRET).update(`v0:${ts}:${body}`).digest("hex");
const route = (body: string, sig = sign(body)) =>
  routeSlackEvent(body, { timestamp: ts, signature: sig }, SECRET, now);

describe("routeSlackEvent", () => {
  it("rejects a bad signature with 401", () => {
    const body = JSON.stringify({ type: "url_verification", challenge: "abc" });
    expect(route(body, "v0=deadbeef")).toMatchObject({ status: 401 });
  });

  it("answers the url_verification handshake with the challenge", () => {
    const body = JSON.stringify({ type: "url_verification", challenge: "chal-123" });
    expect(route(body)).toMatchObject({ status: 200, body: "chal-123" });
  });

  it("acks an event_callback 200 and surfaces the inner event", () => {
    const inner = { type: "reaction_added", user: "U1", reaction: "eyes", item: { type: "message", channel: "C1", ts: "1.2" } };
    const body = JSON.stringify({ type: "event_callback", event: inner });
    const r = route(body);
    expect(r).toMatchObject({ status: 200, body: "" });
    expect(r.event).toMatchObject({ type: "reaction_added", reaction: "eyes" });
  });

  it("returns 400 on a valid signature but unparseable body", () => {
    expect(route("not json")).toMatchObject({ status: 400 });
  });

  it("acks unknown event types 200 with no inner event", () => {
    const body = JSON.stringify({ type: "something_else" });
    const r = route(body);
    expect(r).toMatchObject({ status: 200 });
    expect(r.event).toBeUndefined();
  });
});
