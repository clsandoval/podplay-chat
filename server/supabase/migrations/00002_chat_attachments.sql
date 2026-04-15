create table chat_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  session_id text not null,
  file_name text not null,
  file_path text not null,
  mime_type text not null,
  size_bytes integer not null,
  created_at timestamptz default now()
);

create index idx_chat_attachments_session_id on chat_attachments(session_id);

alter table chat_attachments enable row level security;

create policy "Users see own attachments" on chat_attachments
  for all using (auth.uid() = user_id);

insert into storage.buckets (id, name, file_size_limit, allowed_mime_types)
values (
  'chat-attachments',
  'chat-attachments',
  10485760,
  array[
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/csv',
    'text/plain',
    'text/markdown',
    'text/yaml',
    'application/json',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
);

create policy "Users upload to own prefix" on storage.objects
  for insert with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users read own files" on storage.objects
  for select using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users delete own files" on storage.objects
  for delete using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
