-- Encrypted BYO credentials are opaque to Postgres callers. Only service_role may access rows;
-- rows are keyed by user and provider and disappear when an auth account is deleted.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'credential-a@example.com'),
  ('00000000-0000-0000-0000-0000000000d2', 'credential-b@example.com');

select ok((select relrowsecurity from pg_class where oid = 'public.ai_credentials'::regclass), 'RLS is enabled');
select ok(has_table_privilege('service_role', 'public.ai_credentials', 'select,insert,update,delete'), 'service role can manage encrypted credentials');
select ok(not has_table_privilege('authenticated', 'public.ai_credentials', 'select'), 'authenticated has no read grant');
select ok(not has_table_privilege('authenticated', 'public.ai_credentials', 'insert'), 'authenticated has no insert grant');
select ok(not has_table_privilege('anon', 'public.ai_credentials', 'select'), 'anon has no read grant');

set local role service_role;
insert into public.ai_credentials (user_id, provider, ciphertext, nonce, auth_tag) values
  ('00000000-0000-0000-0000-0000000000d1', 'minimax', 'encrypted-A', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA=='),
  ('00000000-0000-0000-0000-0000000000d2', 'minimax', 'encrypted-B', 'BBBBBBBBBBBBBBBB', 'BBBBBBBBBBBBBBBBBBBBBB==');
select is((select count(*) from public.ai_credentials), 2::bigint, 'service role can insert credentials for separate users');
select is((select ciphertext from public.ai_credentials where user_id = '00000000-0000-0000-0000-0000000000d1'), 'encrypted-A', 'rows remain scoped by user id');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select * from public.ai_credentials $$, '42501', null, 'authenticated cannot read ciphertext');
select throws_ok($$ insert into public.ai_credentials (user_id, provider, ciphertext, nonce, auth_tag) values ('00000000-0000-0000-0000-0000000000d1', 'minimax', 'x', '1234567890123456', '123456789012345678901234') $$, '42501', null, 'authenticated cannot insert credentials');
select throws_ok($$ update public.ai_credentials set ciphertext = 'exposed' $$, '42501', null, 'authenticated cannot update ciphertext');
select throws_ok($$ delete from public.ai_credentials $$, '42501', null, 'authenticated cannot delete credentials');
reset role;

set local role anon;
select throws_ok($$ select * from public.ai_credentials $$, '42501', null, 'anonymous cannot read ciphertext');
select throws_ok($$ delete from public.ai_credentials $$, '42501', null, 'anonymous cannot delete credentials');
reset role;

set local role service_role;
update public.ai_credentials set ciphertext = 'rotated' where user_id = '00000000-0000-0000-0000-0000000000d1';
select is((select ciphertext from public.ai_credentials where user_id = '00000000-0000-0000-0000-0000000000d1'), 'rotated', 'service role can rotate encrypted value');
delete from public.ai_credentials where user_id = '00000000-0000-0000-0000-0000000000d1';
select is((select count(*) from public.ai_credentials), 1::bigint, 'service role can delete one user credential');
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-0000000000d2';
select is((select count(*) from public.ai_credentials), 0::bigint, 'account deletion cascades credential deletion');

select throws_ok($$ insert into public.ai_credentials (user_id, provider, ciphertext, nonce, auth_tag) values ('00000000-0000-0000-0000-0000000000d1', 'openai', 'x', '1234567890123456', '123456789012345678901234') $$, '23514', null, 'unsupported provider is rejected');
select throws_ok($$ insert into public.ai_credentials (user_id, provider, ciphertext, nonce, auth_tag) values ('00000000-0000-0000-0000-0000000000d1', 'minimax', 'x', 'short', '123456789012345678901234') $$, '23514', null, 'invalid nonce size is rejected');
select throws_ok($$ insert into public.ai_credentials (user_id, provider, ciphertext, nonce, auth_tag) values ('00000000-0000-0000-0000-0000000000d1', 'minimax', 'x', '1234567890123456', 'short') $$, '23514', null, 'invalid authentication tag size is rejected');

select * from finish();
rollback;
