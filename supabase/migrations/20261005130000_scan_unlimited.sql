-- The owner's own account can scan without the per-tester or daily limits (docs/testers.md). The
-- flag lives on the invite, set only in the SQL editor / service role, so visitors cannot grant it.
-- An unlimited account's scans are still counted, so the day's total reflects every billable attempt.

alter table public.scan_invites add column unlimited boolean not null default false;

-- What the caller has left today (UTC), for the scan screen. An unlimited account always has plenty.
create or replace function public.scan_allowance() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_status text := public.scan_invite_status();
  v_day date := (now() at time zone 'utc')::date;
  v_limits public.scan_limits;
  v_mine integer;
  v_total integer;
  v_unlimited boolean;
begin
  select * into v_limits from public.scan_limits;
  select coalesce((select scans from public.scan_usage where user_id = auth.uid() and day = v_day), 0) into v_mine;
  select coalesce((select scans from public.scan_daily_totals where day = v_day), 0) into v_total;
  select coalesce(bool_or(unlimited), false) into v_unlimited
    from public.scan_invites where redeemed_by = auth.uid() and revoked_at is null;
  return jsonb_build_object(
    'status', v_status,
    'tester_left', case when v_unlimited then 999 else greatest(coalesce(v_limits.per_tester_daily, 0) - v_mine, 0) end,
    'global_left', case when v_unlimited then 999 else greatest(coalesce(v_limits.global_daily, 0) - v_total, 0) end
  );
end;
$$;

-- Same reservation as before; an unlimited account skips the two ceilings but is still counted.
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
  end if;

  update public.scan_daily_totals set scans = scans + 1 where day = v_day;
  update public.scan_usage set scans = scans + 1 where user_id = v_uid and day = v_day;
  return 'allowed';
end;
$$;
