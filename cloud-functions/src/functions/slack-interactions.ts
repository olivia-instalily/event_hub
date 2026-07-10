// cloud-functions/src/functions/slack-interactions.ts
import { Request, Response } from 'express';
import { verifySlackSignature } from '../lib/slack.js';
import { getServiceClient } from '../db.js';

export async function handler(req: Request, res: Response) {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');
  const secret = process.env.SLACK_SIGNING_SECRET;
  const ok = verifySlackSignature(raw, req.header('x-slack-request-timestamp'), req.header('x-slack-signature'), secret ?? '');
  if (!ok) { res.status(401).send('bad signature'); return; }

  let payload: any;
  try { payload = JSON.parse(new URLSearchParams(raw).get('payload') ?? '{}'); }
  catch { res.status(400).send('bad payload'); return; }

  try {
    if (payload.type === 'block_actions') { await onAction(payload, res); return; }
    if (payload.type === 'view_submission') { await onSubmit(payload, res); return; }
    res.status(200).send(''); // ignore other interaction types
  } catch (e) {
    console.error(JSON.stringify({ fn: 'slack-interactions', error: String((e as Error)?.message ?? e) }));
    res.status(200).send(''); // ack even on error so Slack doesn't retry-storm; logged above
  }
}

const slackApi = async (method: string, body: unknown) => {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  return await r.json() as any;
};

async function onAction(payload: any, res: Response) {
  const action = payload.actions?.[0];
  const eventId = action?.value;
  // Carry the event's deep link (from the original message's link button) through the modal so the
  // resolved message can link back to the event.
  const link = (payload.message?.blocks ?? []).flatMap((b: any) => b.elements ?? []).find((e: any) => e.url)?.url ?? null;
  const meta = JSON.stringify({ eventId, channel: payload.channel?.id, ts: payload.message?.ts, link });
  // Ack the button click immediately (empty 200) — the modal is opened via the trigger_id.
  res.status(200).send('');
  // Post-ack work runs after the response; wrap so errors are logged rather than becoming unhandled rejections.
  try {
    if (action?.action_id === 'approve') {
      // Pre-fill the amount with the requested budget; the approver can still change it before submit.
      const { data: appr } = await getServiceClient().from('budget_approval').select('requested_amount').eq('event_id', eventId).maybeSingle();
      const requested = (appr as any)?.requested_amount;
      const amountEl: Record<string, unknown> = { type: 'number_input', is_decimal_allowed: false, action_id: 'value' };
      if (requested != null) amountEl.initial_value = String(requested);
      const result = await slackApi('views.open', { trigger_id: payload.trigger_id, view: {
        type: 'modal', callback_id: 'approve_modal', private_metadata: meta,
        title: { type: 'plain_text', text: 'Approve budget' },
        submit: { type: 'plain_text', text: 'Approve' },
        blocks: [{ type: 'input', block_id: 'amt', label: { type: 'plain_text', text: 'Assigned amount (USD)' },
          element: amountEl }],
      } });
      if (!result.ok) console.error(JSON.stringify({ fn: 'slack-interactions', op: 'views.open', error: result.error }));
    } else if (action?.action_id === 'decline') {
      const result = await slackApi('views.open', { trigger_id: payload.trigger_id, view: {
        type: 'modal', callback_id: 'decline_modal', private_metadata: meta,
        title: { type: 'plain_text', text: 'Decline budget' },
        submit: { type: 'plain_text', text: 'Decline' },
        blocks: [{ type: 'input', block_id: 'reason', label: { type: 'plain_text', text: 'Reason (required)' },
          element: { type: 'plain_text_input', multiline: true, action_id: 'value' } }],
      } });
      if (!result.ok) console.error(JSON.stringify({ fn: 'slack-interactions', op: 'views.open', error: result.error }));
    }
  } catch (e) {
    console.error(JSON.stringify({ fn: 'slack-interactions', op: 'onAction-post-ack', error: String((e as Error)?.message ?? e) }));
  }
}

async function onSubmit(payload: any, res: Response) {
  const view = payload.view;
  const meta = JSON.parse(view.private_metadata || '{}');
  const eventId = meta.eventId as string;
  const userId = payload.user?.id as string;                 // for the <@id> Slack mention
  const userName = payload.user?.username || payload.user?.name || userId; // readable, stored as decider_ref (shown in-app)
  const supa = getServiceClient();

  // Idempotency: if already resolved, no-op and just refresh the message.
  const { data: existing } = await supa.from('budget_approval').select('status').eq('event_id', eventId).maybeSingle();
  const already = (existing as any)?.status;
  if (already === 'assigned' || already === 'declined') {
    res.status(200).send(''); // close the modal
    await updateMessage(meta, `Already ${already} — no change.`);
    return;
  }

  const nowIso = new Date().toISOString();
  if (view.callback_id === 'approve_modal') {
    const amount = Number(view.state.values.amt.value.value);
    if (!Number.isFinite(amount)) { res.status(200).json({ response_action: 'errors', errors: { amt: 'Enter a number' } }); return; }
    // Mirror Phase 0 assignBudget: set the target, then flip approval state. Keep in sync with src/lib/db.ts.
    // Unlike the in-app setEventBudgetTarget, this path does not call graduateFromConcept — intentional for Phase 1 (a budgeted event is past Concept in practice).
    const { error: eventUpdateErr } = await supa.from('event').update({ event_budget_target: amount }).eq('id', eventId);
    if (eventUpdateErr) throw eventUpdateErr;
    // CAS: only flip if still submitted — guards against concurrent double-clicks.
    const { data: won, error: flipErr } = await supa.from('budget_approval')
      .update({ status: 'assigned', decided_via: 'slack', decider_ref: userName, decided_at: nowIso, decline_reason: null, updated_at: nowIso })
      .eq('event_id', eventId).eq('status', 'submitted').select('event_id');
    if (flipErr) throw flipErr;
    if (!won || won.length === 0) { res.status(200).send(''); await updateMessage(meta, 'Already resolved — no change.'); return; }
    res.status(200).send('');
    await updateMessage(meta, `Approved by <@${userId}> — $${amount} assigned.`);
    return;
  }
  if (view.callback_id === 'decline_modal') {
    const reason = String(view.state.values.reason.value.value || '').trim();
    if (!reason) { res.status(200).json({ response_action: 'errors', errors: { reason: 'A reason is required' } }); return; }
    // Mirror Phase 0 declineBudget: flip declined state. Keep in sync with src/lib/db.ts.
    // CAS: only flip if still submitted — guards against concurrent double-clicks.
    const { data: won, error: flipErr } = await supa.from('budget_approval')
      .update({ status: 'declined', decline_reason: reason, decided_via: 'slack', decider_ref: userName, decided_at: nowIso, updated_at: nowIso })
      .eq('event_id', eventId).eq('status', 'submitted').select('event_id');
    if (flipErr) throw flipErr;
    if (!won || won.length === 0) { res.status(200).send(''); await updateMessage(meta, 'Already resolved — no change.'); return; }
    res.status(200).send('');
    await updateMessage(meta, `Declined by <@${userId}> — ${reason}`);
    return;
  }
  res.status(200).send('');
}

async function updateMessage(meta: { channel?: string; ts?: string; link?: string | null }, text: string) {
  if (!meta.channel || !meta.ts) return;
  const full = meta.link ? `${text}\n<${meta.link}|Open the event →>` : text;
  await slackApi('chat.update', { channel: meta.channel, ts: meta.ts, text: full, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: full } }] });
}
