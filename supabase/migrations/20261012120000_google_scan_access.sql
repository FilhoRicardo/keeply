-- RF-356. Anyone signed in with Google may use AI scans without an invite. Anonymous sessions
-- still need a redeemed, unrevoked invite. Limits: 10 per person per UTC day, and 12 non-owner
-- scans shared per UTC day. An unlimited account (the owner) is still recorded and is never
-- blocked, and those scans do not use the shared cap.
--
-- Compatible with the app already deployed: reserve_scan() and scan_allowance() keep the same
-- arguments and the same result values. A Google sign-in is reported as status 'invited' (the
-- caller may scan, subject to the limits), so the current scan screen shows scans left and does
-- not ask for a code. Apply this before deploying the copy that drops the invite wording.

alter table public.scan_limits alter column per_tester_daily set default 10;
alter table public.scan_limits alter column global_daily set default 12;
update public.scan_limits set per_tester_daily = 10, global_daily = 12;

-- 'invited' means the caller may scan: a live invite, or a signed-in account whose
-- is_anonymous claim is not the text 'true'. 'no_invite' is only an anonymous session
-- without a live invite. 'signed_out' is unchanged.
create or replace function public.scan_invite_status() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when (select auth.uid()) is null then 'signed_out'
    when exists (
      select 1 from public.scan_invites
      where redeemed_by = (select auth.uid()) and revoked_at is null
    ) then 'invited'
    when coalesce((select auth.jwt() ->> 'is_anonymous'), '') is distinct from 'true' then 'invited'
    else 'no_invite'
  end
$$;

-- Binds an unused invite to the caller. A Google sign-in is already 'invited' for scanning, so
-- this checks the invite row itself: that account can still redeem a code (the owner's unlimited
-- flag lives on one). 'invited', 'already_invited', 'invalid' or 'signed_out'.
create or replace function public.redeem_scan_invite(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return 'signed_out'; end if;
  if exists (
    select 1 from public.scan_invites
    where redeemed_by = v_uid and revoked_at is null
  ) then return 'already_invited'; end if;
  update public.scan_invites
  set redeemed_by = v_uid, redeemed_at = now()
  where code_hash = public.invite_code_hash(p_code) and redeemed_by is null and revoked_at is null;
  return case when found then 'invited' else 'invalid' end;
exception when unique_violation then
  return 'already_invited';
end;
$$;

-- Reserves one AI scan, or says why not. Same results as before. A non-anonymous sign-in is
-- allowed without an invite; an anonymous session still needs one. Unlimited scans are written
-- to scan_usage and are not added to scan_daily_totals, which is the shared non-owner cap.
create or replace function public.reserve_scan() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_status text := public.scan_invite_status();
  v_day date := (now() at time zone 'utc')::date;
  v_limits public.scan_limits;
  v_total integer;
  v_mine integer;
  v_unlimited boolean;
begin
  if v_status <> 'invited' then return v_status; end if;
  select * into v_limits from public.scan_limits;
  -- No limits row means no allowance: fail closed.
  if v_limits.per_tester_daily is null or v_limits.global_daily is null then return 'daily_limit'; end if;
  select coalesce(bool_or(unlimited), false) into v_unlimited
    from public.scan_invites where redeemed_by = v_uid and revoked_at is null;

  insert into public.scan_daily_totals (day) values (v_day) on conflict do nothing;
  select scans into v_total from public.scan_daily_totals where day = v_day for update;
  insert into public.scan_usage (user_id, day) values (v_uid, v_day) on conflict do nothing;
  select scans into v_mine from public.scan_usage where user_id = v_uid and day = v_day for update;

  if not v_unlimited then
    if v_mine >= v_limits.per_tester_daily then return 'tester_limit'; end if;
    if v_total >= v_limits.global_daily then return 'daily_limit'; end if;
    update public.scan_daily_totals set scans = scans + 1 where day = v_day;
  end if;

  update public.scan_usage set scans = scans + 1 where user_id = v_uid and day = v_day;
  return 'allowed';
end;
$$;
