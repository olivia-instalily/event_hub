-- Private bucket for SENSITIVE dropped docs (briefs, budgets, debriefs, vendor sheets) — the
-- files that become an event's "source materials" / budget provenance. Unlike the public
-- `attachments` bucket (cover images / avatars, low sensitivity), these are served only via
-- short-lived SIGNED URLs, so they aren't fetchable by raw URL on Supabase's public domain.
insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
on conflict (id) do nothing;

-- anon/authenticated may upload and (to mint signed URLs) read objects in this bucket. Under
-- access model (c) the anon key is reachable only through the IAP-gated reverse-proxy, so this
-- is effectively org-gated; signed URLs are short-lived on top of that.
create policy "documents_read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'documents');
create policy "documents_insert" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'documents');
create policy "documents_delete" on storage.objects
  for delete to anon, authenticated using (bucket_id = 'documents');
