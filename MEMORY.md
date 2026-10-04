# Memory — Keeply

Durable decisions only. One or two sentences each. Not a task log.

## Source Links

- GitHub: https://github.com/FilhoRicardo/keeply
- Paperclip company: Keeply (`7a57a3ab-b378-4d66-9ae3-34d68a114981`, prefix `KEE`)
- Plan: `docs/HANDOFF.md`

## Key Decisions

- Paperclip replaces Linear as Keeply's issue tracker (decided 2026-10-04); no Linear project will be created. This is a project-level exception to the root workflow.
- Registered 2026-10-04. Scope follows `docs/HANDOFF.md`: dishwashers only, Phase 0 + 1 first, no AI recognition until the approval/calendar skeleton works.
- Agent team in Paperclip: CEO, CTO, CFO on Opus 5.5 (`claude-opus-5-5`); Builders 1–2 on Sonnet 5.5 (`claude-sonnet-5-5`); Builders 3–4 on Codex (`gpt-5.6-sol`, medium). The Codex model was set as the closest match to "Sol 6.1"; confirm.

## Constraints

- Free-tier infrastructure (Vercel, Supabase) during validation; no subsidised AI for beta users.

## Durable Outcomes

- 2026-10-04: owner chose the full magic-minute flow as the finish line, with Brave Search + MiniMax manual reading and "verified only with a code-checked quote from the manufacturer's document". Invited testers get funded AI behind an invite code (5/tester/day, 100/day total). Details: `docs/HANDOFF.md` §23.
- 2026-10-04: owner cut the build to the MVP: photo → identify → plan → Accept / Reject → Google Calendar, managed there. Supabase keeps only appliances, tasks and usage counts; Customise, completions, pause, catalog and photo storage were removed (`docs/HANDOFF.md` §24).
