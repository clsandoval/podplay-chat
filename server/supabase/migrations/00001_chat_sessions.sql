create table chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  session_id text not null,
  agent_id text not null,
  title text,
  status text default 'active',
  created_at timestamptz default now(),
  last_message_at timestamptz
);

create index idx_chat_sessions_user_id on chat_sessions(user_id);
create index idx_chat_sessions_session_id on chat_sessions(session_id);

alter table chat_sessions enable row level security;

create policy "Users see own sessions" on chat_sessions
  for all using (auth.uid() = user_id);
