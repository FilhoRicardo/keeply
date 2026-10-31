-- RF-357: ai_credentials is gone. Prove the MiniMax-only credential table is not present after
-- migrations, so a leftover BYO store cannot silently return.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(1);

select ok(
  to_regclass('public.ai_credentials') is null,
  'ai_credentials was dropped with MiniMax BYO (RF-357)'
);

select * from finish();
rollback;
