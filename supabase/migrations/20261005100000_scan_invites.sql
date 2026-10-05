-- AI label scanning for invited testers (docs/HANDOFF.md §23): an invite code unlocks AI reading
-- for one Keeply user; each tester gets at most N scans per UTC day and all testers together at
-- most M per UTC day. Counting happens here, in one locked transaction per scan, before the server
-- calls any billable provider. Visitors can only call the functions below; the tables are closed.

create table public.scan_invites (
  id uuid primary key default gen_random_uuid(),
  -- sha256 of the normalised code; the code itself is shown once, when it is created.
  code_hash text not null unique,
  -- A non-personal label for the owner, e.g. "Tester 3". Never an email or name.
  note text check (length(note) <= 80),
  created_at timestamptz not null default now(),
  -- Deleting the account deletes its invite, so a used code can never be redeemed again.
  redeemed_by uuid references auth.users (id) on delete cascade,
  redeemed_at timestamptz,
  revoked_at timestamptz
);
-- One live invite per person; a revoked tester can be given a new one.
create unique index scan_invites_one_live_per_user on public.scan_invites (redeemed_by) where revoked_at is null;

-- One row: the limits. The owner changes them in the SQL editor.
create table public.scan_limits (
  id boolean primary key default true check (id),
  per_tester_daily integer not null default 5 check (per_tester_daily >= 0),
  global_daily integer not null default 100 check (global_daily >= 0)
);
insert into public.scan_limits default values;

create table public.scan_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  scans integer not null default 0 check (scans >= 0),
  primary key (user_id, day)
);

create table public.scan_daily_totals (
  day date primary key,
  scans integer not null default 0 check (scans >= 0)
);

alter table public.scan_invites enable row level security;
alter table public.scan_limits enable row level security;
alter table public.scan_usage enable row level security;
alter table public.scan_daily_totals enable row level security;
revoke all on public.scan_invites, public.scan_limits, public.scan_usage, public.scan_daily_totals
  from public, anon, authenticated;

-- Codes look like KP-7F3A-91C2-0D4E-B8A1: 64 random bits, case and dashes ignored.
create function public.normalise_invite_code(p_code text) returns text
language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

create function public.invite_code_hash(p_code text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(public.normalise_invite_code(p_code), 'UTF8')), 'hex')
$$;

-- Owner only (SQL editor / service role): creates one invite and returns its code, once.
create function public.create_scan_invite(p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  -- 16 hex digits of a hash over two random UUIDs: 64 uniformly random bits.
  v_hex text := upper(substr(encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex'), 1, 16));
  v_code text := 'KP-' || substr(v_hex, 1, 4) || '-' || substr(v_hex, 5, 4) || '-' || substr(v_hex, 9, 4) || '-' || substr(v_hex, 13, 4);
begin
  insert into public.scan_invites (code_hash, note) values (public.invite_code_hash(v_code), p_note);
  return v_code;
end;
$$;
revoke execute on function public.create_scan_invite(text) from public, anon, authenticated;

-- The caller's access: 'invited', 'no_invite' or 'signed_out'.
create function public.scan_invite_status() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when (select auth.uid()) is null then 'signed_out'
    when exists (
      select 1 from public.scan_invites
      where redeemed_by = (select auth.uid()) and revoked_at is null
    ) then 'invited'
    else 'no_invite'
  end
$$;

-- Binds an unused invite to the caller: 'invited', 'already_invited', 'invalid' or 'signed_out'.
create function public.redeem_scan_invite(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return 'signed_out'; end if;
  if public.scan_invite_status() = 'invited' then return 'already_invited'; end if;
  update public.scan_invites
  set redeemed_by = v_uid, redeemed_at = now()
  where code_hash = public.invite_code_hash(p_code) and redeemed_by is null and revoked_at is null;
  return case when found then 'invited' else 'invalid' end;
exception when unique_violation then
  -- A second redeem by the same person raced the first one.
  return 'already_invited';
end;
$$;

-- What the caller has left today (UTC), for the scan screen. Reads only.
create function public.scan_allowance() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_status text := public.scan_invite_status();
  v_day date := (now() at time zone 'utc')::date;
  v_limits public.scan_limits;
  v_mine integer;
  v_total integer;
begin
  select * into v_limits from public.scan_limits;
  select coalesce((select scans from public.scan_usage where user_id = auth.uid() and day = v_day), 0) into v_mine;
  select coalesce((select scans from public.scan_daily_totals where day = v_day), 0) into v_total;
  return jsonb_build_object(
    'status', v_status,
    'tester_left', greatest(coalesce(v_limits.per_tester_daily, 0) - v_mine, 0),
    'global_left', greatest(coalesce(v_limits.global_daily, 0) - v_total, 0)
  );
end;
$$;

-- Reserves one AI scan for the caller, or says why not: 'allowed', 'signed_out', 'no_invite',
-- 'tester_limit' or 'daily_limit'. Every reservation is one billable attempt and is never given
-- back (a failed or timed-out provider call may still be billed), so the limits are hard ceilings
-- on provider requests. Usage is counted per user and day, so revoking and re-inviting the same
-- account does not reset it. The day's total row is locked first: concurrent calls queue and the
-- limits hold exactly. Call before every billable provider request.
create function public.reserve_scan() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_status text := public.scan_invite_status();
  v_day date := (now() at time zone 'utc')::date;
  v_limits public.scan_limits;
  v_total integer;
  v_mine integer;
begin
  if v_status <> 'invited' then return v_status; end if;
  select * into v_limits from public.scan_limits;
  -- No limits row means no allowance: fail closed.
  if v_limits.per_tester_daily is null or v_limits.global_daily is null then return 'daily_limit'; end if;

  insert into public.scan_daily_totals (day) values (v_day) on conflict do nothing;
  select scans into v_total from public.scan_daily_totals where day = v_day for update;
  insert into public.scan_usage (user_id, day) values (v_uid, v_day) on conflict do nothing;
  select scans into v_mine from public.scan_usage where user_id = v_uid and day = v_day for update;

  if v_mine >= v_limits.per_tester_daily then return 'tester_limit'; end if;
  if v_total >= v_limits.global_daily then return 'daily_limit'; end if;

  update public.scan_daily_totals set scans = scans + 1 where day = v_day;
  update public.scan_usage set scans = scans + 1 where user_id = v_uid and day = v_day;
  return 'allowed';
end;
$$;

revoke execute on function public.scan_invite_status(), public.redeem_scan_invite(text),
  public.scan_allowance(), public.reserve_scan() from public, anon;
grant execute on function public.scan_invite_status(), public.redeem_scan_invite(text),
  public.scan_allowance(), public.reserve_scan() to authenticated;

-- Usage counts for the new steps (names and booleans only).
alter table public.funnel_events drop constraint funnel_events_name_check;
alter table public.funnel_events add constraint funnel_events_name_check check (name in (
  'scan_started', 'label_read', 'appliance_added', 'plan_proposed', 'plan_approved',
  'calendar_connected', 'calendar_tasks_created', 'invite_redeemed', 'scan_denied',
  -- P3-5 (KEE-42): the plan search itself, with the search outcome (counts only).
  'plan_search'
));
