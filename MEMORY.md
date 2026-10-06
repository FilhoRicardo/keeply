# Memory — Keeply

Durable decisions only. One or two sentences each. Not a task log.

## Source Links

- GitHub: https://github.com/FilhoRicardo/keeply
- Paperclip company: Keeply (`7a57a3ab-b378-4d66-9ae3-34d68a114981`, prefix `KEE`)
- Plan: `docs/HANDOFF.md`

## Key Decisions

- Paperclip replaces Linear as Keeply's issue tracker (decided 2026-10-04); no Linear project will be created. This is a project-level exception to the root workflow.
- Registered 2026-10-04. Scope follows `docs/HANDOFF.md`: dishwashers only, Phase 0 + 1 first, no AI recognition until the approval/calendar skeleton works.
- Agent team in Paperclip until 2026-10-05 (superseded below): CEO, CTO, CFO on Opus 5.5 (`claude-opus-5-5`); Builders 1–2 on Sonnet 5.5 (`claude-sonnet-5-5`); Builders 3–4 on Codex (`gpt-5.6-sol`, medium). The Codex model was set as the closest match to "Sol 6.1"; confirm.

## Constraints

- Free-tier infrastructure (Vercel, Supabase) during validation; no subsidised AI for beta users.

## Durable Outcomes

- 2026-10-06: Paperclip team reset to a lean setup: Lead and Builder active; Researcher, UX, UI paused until a ticket needs them; CEO, CFO, Intern retired. All on MiniMax-M3 (`hermes_local`); Paperclip budgets are set ($25/month company, $10 Lead/Builder, $5 others) but are inactive: they only measure `billed_cents`, and the MiniMax Token Plan bills 0, so they cap nothing unless an agent moves to a metered API. Real limits are the plan's 5-hour/weekly windows and keeping heartbeats off and three roles paused. Matt Pocock skills `v1.2.3` attached by role. Why: the first team spent tokens on coordination and passed CI while four core bugs were live; guardrails now live in each ticket's execution policy.
- 2026-10-05: scan limits are set in Supabase: 3 scans per user per UTC day and 100 in total; the owner's invite is `unlimited` (migration `20261005130000_scan_unlimited.sql`). Scanning is on in Production (`NEXT_PUBLIC_KEEPLY_SCAN=1`); `SUPABASE_SERVICE_ROLE_KEY` is still not set in Vercel (owner action).
- 2026-10-05: owner authorised hosted BYO MiniMax API-key settings (KEE-47), overriding the earlier no-consumer-key-entry restriction. Keys are encrypted server-side per signed-in user; invite limits remain 5/user/day and 100/day. Appliance identification only; no silent fallback from a personal key to app-funded AI. See HANDOFF §25.

- 2026-10-04: owner chose the full magic-minute flow as the finish line, with Brave Search + MiniMax manual reading and "verified only with a code-checked quote from the manufacturer's document". Invited testers get funded AI behind an invite code (5/tester/day, 100/day total). Details: `docs/HANDOFF.md` §23.
- 2026-10-04: owner cut the build to the MVP: photo → identify → plan → Accept / Reject → Google Calendar, managed there. Supabase keeps only appliances, tasks and usage counts; Customise, completions, pause, catalog and photo storage were removed (`docs/HANDOFF.md` §24).
