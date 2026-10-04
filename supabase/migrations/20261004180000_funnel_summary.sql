-- Validation funnel counts (docs/HANDOFF.md §15): distinct visitors and events per step.
-- For the team via the service role / SQL editor; visitors cannot read it.
create view public.funnel_summary with (security_invoker = true) as
select
  name as step,
  count(distinct user_id) as visitors,
  count(*) as events,
  min(occurred_at) as first_seen,
  max(occurred_at) as last_seen
from public.funnel_events
group by name;

revoke all on public.funnel_summary from anon, authenticated;
