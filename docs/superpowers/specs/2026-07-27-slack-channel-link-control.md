# Slack channel link control on the event card

**Date:** 2026-07-27
**Status:** Approved (design)

## Problem & intent

The `:eventhub:` capture pipeline routes a pinned message to the event whose `event.slack_channel`
matches the reacting channel — but there's no in-app way to set that link. Today it's a manual
`update event set slack_channel=…`. This adds a control on the event card to **link an existing
channel** or **create a new private channel** (suggested name `evt-<slug>`, owners invited) and
persist the link.

## Scope

In: the card-footer control, one server endpoint that links/creates + sets `event.slack_channel`
(service-role), the `db.ts` helpers, and surfacing `slackChannel` on the event list item.

Out: the capture pipeline itself (already shipped); the Slack app scope/config changes are
operational (listed under Deploy parity).

## Server — `cloud-functions/src/functions/slack-link-channel.ts`

cloud-functions only (no Deno twin, like the other `slack-*` reaction handlers). `POST` body is
one of:

- `{ eventId, channelId }` — link an existing channel.
- `{ eventId, create: { name } }` — create a **private** channel then link it.

Behavior:
1. **Create path:** `conversations.create({ name, is_private: true })`. On `name_taken`, return
   `{ error: 'name_taken' }` so the UI can prompt for a new name. The bot is auto-member (creator).
2. **Invite owners (create path):** query the event's owners' emails
   (`event_owner → profile.email` for `event_id`); for each, `users.lookupByEmail`; collect the
   resolved Slack user ids and `conversations.invite({ channel, users })`. Owners whose email
   doesn't resolve are returned in `skipped: string[]` (names), not fatal.
3. **Set the link (both paths):** `getServiceClient().from('event').update({ slack_channel: channelId }).eq('id', eventId)`.
4. Return `{ ok: true, id, name, skipped? }`.

New Slack scopes required: **`groups:write`** (create/manage private channels + invite),
**`users:read.email`** (owner lookup). `SLACK_BOT_TOKEN` already deployed.

## Frontend — `SlackChannelControl` (`src/components/SlackChannelControl.tsx`)

Rendered in the **card footer** (the row where the Luma attach control lives) on the Events-page
card. Props: `{ eventId, title, slackChannel, onChange }`.

- **Unlinked** (`!slackChannel`): a "Link Slack" button opens a small popover with two paths:
  - **Create** — a text field prefilled with `evt-<slug>` (from `title`; **editable** so a
    `name_taken` collision can be fixed) + a Create button → `linkSlackChannel(eventId, { create: { name } })`.
  - **Pick existing** — a searchable list from the existing `listSlackChannels()`; selecting one
    calls `linkSlackChannel(eventId, { channelId })`.
  - On success: show the linked state; toast any `skipped` owners ("couldn't add N owner(s) — not
    found in Slack by email").
- **Linked** (`slackChannel` set): shows `#<channel-name>` (name from `listSlackChannels()` lookup,
  falling back to the id) as a link to `https://slack.com/app_redirect?channel=<id>` (opens the
  channel; no team id needed), plus an **Unlink** action → `unlinkSlackChannel(eventId)`.

## `db.ts`

- Add `slackChannel: string | null` to `EventListItem`, `EVENT_LIST_SELECT` (`slack_channel`), and
  `toListItem` (`slackChannel: row.slack_channel ?? null`).
- `linkSlackChannel(eventId, arg: { channelId: string } | { create: { name: string } }): Promise<{ id: string; name: string; skipped?: string[] }>` — invokes `slack-link-channel`.
- `unlinkSlackChannel(eventId): Promise<void>` — invokes `slack-link-channel` with `{ eventId, channelId: null }` (server sets `slack_channel = null`), OR a direct service-role clear via the same endpoint. Keep it on the endpoint so no client column-grant is needed.
- `slugifyChannel(title): string` — pure: lowercase, non-alphanumeric → `-`, collapse repeats, trim
  to Slack's 80-char limit, prefix `evt-`. Testable.

## Constraints & non-goals

- Reuses `event.slack_channel` (already in prod) — **no migration**.
- Link/unlink writes go through the server (service role); the client never needs a PostgREST
  column grant on `event.slack_channel`.
- Owner invite is best-effort; unresolved owners are skipped and surfaced, never fatal.

## Testing

- Pure `slugifyChannel` unit tests (spaces, punctuation, unicode, length cap, `evt-` prefix,
  collapse repeats) — TDD.
- The endpoint is Slack + DB I/O — verified by manual end-to-end (create a channel from a card,
  confirm it appears in Slack with owners invited and `event.slack_channel` set; pick an existing
  channel; unlink). No unit assertion on Slack responses.
- Frontend: type-check + build; visual check of the three states.

## Verification

- `cd cloud-functions && npx tsc --noEmit`; root `npx tsc -b && npm run build` clean; slug tests green.
- Deployed: Create → new private channel in Slack, owners invited (or skipped list shown),
  card shows the linked state; the `:eventhub:` pipeline now routes to that event.

## Deploy parity

cloud-functions only (register the new route in `cloud-functions/src/index.ts`). Add Slack scopes
`groups:write` + `users:read.email` and reinstall the app. No migration, no new secret.
