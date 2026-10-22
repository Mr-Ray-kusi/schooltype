-- Published report cards: teachers cannot edit marks after the administrator publishes,
-- unless the administrator grants that teacher a temporary reopen.

create table if not exists public.student_score_locks (
  school_id uuid primary key,
  locks jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table public.student_score_locks enable row level security;
