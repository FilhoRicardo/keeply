-- BYO AI provider credentials are encrypted by the application before reaching Postgres.
-- This table is service-role-only. Authenticated users never receive table access or ciphertext.
create table public.ai_credentials (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('minimax')),
  ciphertext text not null,
  nonce text not null,
  auth_tag text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider),
  check (length(ciphertext) <= 6000),
  check (length(nonce) = 16),
  check (length(auth_tag) = 24)
);

alter table public.ai_credentials enable row level security;
revoke all on public.ai_credentials from public, anon, authenticated;
grant select, insert, update, delete on public.ai_credentials to service_role;
