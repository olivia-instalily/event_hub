# Slack Capture — build brief (canonical)

Consolidated spec for pulling event-planning insights from Slack into EventHub. Supersedes
`2026-07-27-slack-pin-capture.md` (Phase 1 v1) and the scattered chat decisions.

Reference mocks (to be provided as screenshots): the layered event "first page"
(settled facts / Slack captures / compounding hints) with sections Plan · Who · Still-open · Budget,
the Slack section, and the pin-capture ephemeral.

## Build order
1. **Extraction + routing rewrite** (backend) — homes plan/person/open/budget; tentative→open;
   no vendor bucket; prefer fewer; never fabricate; removals; provenance/radius_note; idempotency
   keyed on `home`; un-react = no-op. ← THIS PHASE
2. **Ephemeral rewrite** (backend) — grouped-by-home confirmation. ← THIS PHASE
3. **Event "first page" layered surface** (UI) — captures land in-section (Plan/Who/Still-open/Budget)
   as proposed (violet, Slack icon) with confirm/edit/dismiss/see-source; overwrite of settled data
   is gated; compounding hints later. ← NEXT, needs the screenshots.

## Homes / routing (extraction)
plan = decided flow/format ("jazz then a singer", "pre-pour wine"); person = a person + role
("Doug performs", "Thurman on bar"); open = tentative/conditional OR a to-do ("maybe a mural",
"get quotes", "robot dog if cost works"); budget = a cost figure or budget decision.
Rules: tentative language (potentially/if/depending/might/need a quote) → **open**, never a committed
home. **No vendor bucket.** Prefer FEWER real captures. Never fabricate an unstated value/name/cost/role.
Latest state wins when superseded. Dropped things → **removals**, not captures.

## Commit model
Commit directly (pin = go-ahead) but always `status: proposed`, keyed idempotently on
(event_id, slack_channel, slack_ts, home). Never auto-confirm. Overwriting a SETTLED value → surface a
conflict, don't overwrite. Removals fuzzy-match existing items → dismiss; no match → ignore. Un-react
is a NO-OP (misfires handled by dismiss on the page).

## Context radius
Thread → whole thread; top-level → ~20 before / ~5 after, capped ~30 msgs / ~3h (named constants).
LLM narrows to the pin's decision, ignores unrelated chatter; if the window spans two decisions,
extract only the pinned one. Store which messages were used (radius_note / provenance).

## Ephemeral (reactor-only, chat.postEphemeral)
≤6 lines, grouped by home with counts + short human labels (never raw field syntax). Header
"Captured to {event} — proposed. Review in EventHub."; one line per non-empty home
(`{Home} +{count}  {labels}`); `↳ dropped: {what}` for removals; `read N messages around your pin`
when context pulled; `⚠ wasn't sure…` for ambiguous; a link to the event. Nothing extractable → one
honest "nothing to capture" line. Nothing posts to the channel.

## Extraction JSON output
`{ captures: [{ home, summary, detail, status, source_quote, used_context }], removals: [{ label }], radius_note }`.

## Infra
cloud-functions only; scopes reactions:read/write, channels:history, groups:history, chat:write,
channels:read/join, groups:write, users:read.email (all added). `--no-cpu-throttling` on Cloud Run so
the post-ack async extraction completes. Strict Anthropic json_schema (additionalProperties:false,
all keys required; stringified payloads / nullable scalars).
