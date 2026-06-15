-- Storage bucket for dropped attachments (contracts/invoices). Public-read for the
-- local/internal tool; anon may upload + read. Tighten with auth/ownership later.
insert into storage.buckets (id, name, public) values ('attachments', 'attachments', true)
on conflict (id) do nothing;

create policy "attachments_read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'attachments');
create policy "attachments_insert" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'attachments');
