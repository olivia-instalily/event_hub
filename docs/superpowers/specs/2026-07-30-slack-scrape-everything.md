# Slack ↔ EventHub — integration brief (scrape-everything model)

Date: 2026-07-30
Supersedes `2026-07-27-slack-pin-capture.md` (pin model → now DORMANT, see §8).

> **Core bet is contingent (§4):** the ungated live-but-labeled commit model is only safe if
> extraction quality is validated on real data. First validation (2026-07-30, TEST: Series B
> channel C0BKPQUDHD5) was **encouraging** — ~12/13 captures clean, non-logistics noise (a dev
> feature request + test messages) correctly skipped — but the sample was semi-synthetic (one rich
> summary message). Re-run on an organic channel before treating ungated as final. Tuning items
> found: dedup direction (paid should supersede quote), skip guest names, avoid plan/people dupes.

## 1. The link = the opt-in
An event is paired with one Slack channel (event header's Slack-channel button; stores the
channel↔event mapping). Pairing IS the consent — linking says "scrape this channel for this event."
No per-message action. Unlinking stops the scrape.

## 2. What runs, and when
- Scrape-on-open, incremental: on event open, extract only messages since the "last-extracted-through"
  marker for that channel; advance the marker after.
- Async — never block render. Page renders instantly from stored captures; extraction runs in the
  background. New captures appear next-open (simplest) or this-open via refetch-on-complete (optional).
  Lean next-open first.
- NOT on every message; NOT constantly.
- Optional nightly sweep only if "stale until opened" proves a real problem. Don't pre-build.
- Skip when nothing new (no messages since marker → no call → near-zero cost).

## 3. What gets extracted, and where it routes
Conservative extraction of EVENT FACTS. Each capture routes to ONE home:
- plan — a decided flow/format ("playlist instead of a DJ").
- open — tentative ideas AND to-dos ("potentially a mural"; "still need quotes"). Tentative language
  (potentially / if / depending / maybe / "getting a quote") → open, never plan.
- budget — a figure or cost decision → a budget row, with an OPTIONAL vendor field (no separate
  "vendor" routing target; vendor is a field on the line per the budget model — already true in code).
- people — a role/assignment ("Anoud running logistics"). (Code currently calls this home `person`;
  rename to `people` as part of this work.)
- resources — a shared file/link (Luma page, a doc) → pinned to the event (see documents spec).

Rules: definitive-statements bias; do NOT fabricate unstated details; removals ("mural fell through")
dismiss the matching item; capture fewer, higher-confidence things.

## 4. Commit model — LIVE-BUT-LABELED (the crux)
Pivot away from an approval gate (a gate is itself a manual-effort habit; nobody reliably approves on
an internal tool, so gated items pile up and the page rots).
- Additive / low-stakes captures land as REAL, ungated — a new budget line, an open item, a note. LIVE
  immediately, marked with a Slack-sourced badge. "Proposed" redefined: live-but-labeled, not
  inert-until-approved.
- Correction by exception — dismiss/edit when wrong. Page is useful/complete without approval.
- Only destructive/overwrite actions gate — overwriting a set budget figure, changing a confirmed
  date. Rare → the rare gate is acceptable.

### Open prerequisite (DO NOT SKIP)
Safe only if extraction is conservative/accurate enough that unchecked landing yields a mostly-right
page. First validation on C0BKPQUDHD5 passed encouragingly (see header). Re-run on an organic channel;
if noisy, improve extraction or fall back to a light gate. The whole commit model hinges on this.

## 5. Sticky dismissals + idempotency
Re-scrapes on every open, so must never re-propose handled items:
- Idempotency key: (event_id, channel_id, message_ts, home). Same message → same capture, updated not
  duplicated.
- Sticky dismissals: a dismissed capture stays dismissed against its source message; reprocessing must
  not resurrect it. Same for confirmations/edits — reprocessing doesn't revert them.
- Matters more here than in the pin model (auto-rescrape reprocesses the same messages). Get it wrong
  → dismissed junk returns → trust dies.

## 6. Privacy / access
- Access parity: Slack-derived insights inherit the source channel's access, checked at VIEW time
  (private → current channel members only, so leaving the channel removes access; public → any
  EventHub user). Prevents scraping widening the audience of private info.
- Relevance does most of the privacy work: sensitive-but-irrelevant content (funding, comp, internal
  deliberation) isn't event logistics, so a logistics-focused extraction won't capture it.
- One overlap zone, deferred: named external people (guests, prospects). Both relevant AND sensitive —
  handled with the future Outreach section. Until then, extraction SKIPS guest/invite/outreach content.

## 7. Infra caveat
Scrape-on-open fires background extraction. Cloud Run min-instances-0 can freeze a detached
fire-and-forget before it completes (same as the Slack webhook). Use a real background mechanism
(Cloud Tasks or an independent endpoint), not a detached promise. The "last-extracted-through" marker
MUST be correct — a bug that re-extracts the whole channel every open is slow AND expensive.

## 8. DORMANT — pin / emoji / @eventhub (documented, not built)
Optional accelerant later, NOT the mechanism. If revived: `:eventhub:` reaction / `@eventhub` mention
= capture that message immediately (vs next open); `@eventhub [text]` can carry an authoritative
intent/correction ("thurman is a vendor", "this is confirmed") overriding the model's classification
WITHOUT licensing fabrication. Same pipeline; idempotency dedupes across scrape + pin. Anchor a mention
on thread_ts. Revisit if scrape-alone is too coarse or people want real-time/correction control.
(NOTE: the existing `slack-events` reaction handler + `extractCaptures` pin pipeline is the seed of
this; it stays deployed but is superseded as the primary mechanism.)

## Definition of done (scrape-everything core)
- Link → scrape begins; unlink → stops.
- On open: incremental (since marker), async, instant render from stored captures, marker advances,
  skip when nothing new.
- Routes to plan / open / budget(+optional vendor) / people / resources, conservatively.
- Captures land live-but-labeled (Slack badge), ungated for additive; only destructive gates.
  [CONTINGENT on §4 validation on an organic channel.]
- Idempotent on (event, channel, ts, home); dismissals/confirmations sticky across re-scrapes.
- Access parity at view time; guest/outreach skipped until Outreach ships.
- Background extraction uses a freeze-safe mechanism on Cloud Run.

## Immediate next step
§4 validation — first pass done (encouraging, semi-synthetic). Re-run on an organic channel to fully
clear the gate, applying the tuning items, before building ungated-landing for production.
