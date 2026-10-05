-- Brave Search is paid out of a free quota. The per-process counter lives in src/search/brave.ts
-- (P3-2, KEE-39). The durable counter lives here, in Postgres. The orchestration layer (KEE-42,
-- docs/HANDOFF.md §23) checks this counter BEFORE calling searchManuals, so a Brave call that we
-- already know will be refused is never started. Once the durable counter is at or above the cap,
-- the route falls back to similar-model then general guidance without ever issuing another Brave
-- request (CEO directive 2026-10-05).

create table public.brave_quota_caps (
  id boolean primary key default true check (id),
  -- Owner-set cap on Brave Search calls per UTC month. Brave's free plan gives 2000 queries/month;
  -- default matches that. The owner may tune this down to leave a safety margin before the next
  -- billing window opens.
  free_quota integer not null default 2000 check (free_quota >= 0)
);
insert into public.brave_quota_caps default values;

create table public.brave_quota_usage (
  -- The Brave free quota is monthly. We key by the first UTC day of each calendar month so a new
  -- window starts cleanly. Each successful reservation increments `searches` by exactly one and the
  -- SELECT ... FOR UPDATE below serialises concurrent callers.
  month_start date primary key check (month_start = date_trunc('month', month_start)::date),
  searches integer not null default 0 check (searches >= 0)
);

alter table public.brave_quota_caps enable row level security;
alter table public.brave_quota_usage enable row level security;
revoke all on public.brave_quota_caps, public.brave_quota_usage from public, anon, authenticated;
grant select, insert, update, delete on public.brave_quota_caps, public.brave_quota_usage to service_role;

-- Current month status, for the orchestration layer and the CFO daily report. Counts only: no
-- document text, no URLs. Stable within a transaction so a caller can read it without racing the
-- reservation.
create function public.brave_quota_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_caps public.brave_quota_caps;
  v_month date := date_trunc('month', (now() at time zone 'utc'))::date;
  v_used integer;
begin
  select * into v_caps from public.brave_quota_caps;
  select coalesce((select searches from public.brave_quota_usage where month_start = v_month), 0) into v_used;
  return jsonb_build_object(
    'status', case when v_used >= v_caps.free_quota then 'quota_exhausted' else 'ok' end,
    'used', v_used,
    'cap', v_caps.free_quota,
    'month_start', v_month
  );
end;
$$;

-- Reserves one Brave Search call for the caller. Returns 'allowed' and increments the durable
-- counter, or 'quota_exhausted' without touching searchManuals. Two callers cannot both believe
-- they each got a slot: SELECT ... FOR UPDATE serialises reservations inside one transaction. The
-- upsert adds a fresh month row on first reservation of a new month.
create function public.reserve_brave_search() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_caps public.brave_quota_caps;
  v_month date := date_trunc('month', (now() at time zone 'utc'))::date;
  v_used integer;
begin
  select * into v_caps from public.brave_quota_caps;
  if v_caps.free_quota is null then return 'quota_exhausted'; end if;

  insert into public.brave_quota_usage (month_start) values (v_month) on conflict do nothing;
  select searches into v_used from public.brave_quota_usage where month_start = v_month for update;
  if v_used >= v_caps.free_quota then return 'quota_exhausted'; end if;
  update public.brave_quota_usage set searches = searches + 1 where month_start = v_month;
  return 'allowed';
end;
$$;

revoke execute on function public.brave_quota_status() from public, anon;
grant execute on function public.brave_quota_status() to authenticated, service_role;
revoke execute on function public.reserve_brave_search() from public, anon, authenticated;
grant execute on function public.reserve_brave_search() to service_role;