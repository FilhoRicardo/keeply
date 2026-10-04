-- Minimal local stand-in for the parts of Supabase the migrations use (roles, auth.users, auth.uid()).
-- For plain-Postgres tests only; real Supabase already provides all of this.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select from pg_roles where rolname = 'authenticator') then create role authenticator login password 'authpass' noinherit; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
create schema auth; create schema extensions;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), current_setting('request.jwt.claims', true)::jsonb ->> 'sub'), '')::uuid $$;
grant usage on schema auth, public, extensions to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
