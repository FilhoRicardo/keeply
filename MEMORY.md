# Memory — Keeply

Durable decisions only. One or two sentences each. Not a task log.

## Source Links

- GitHub: https://github.com/FilhoRicardo/keeply
- Retired tracker: Paperclip company Keeply (`7a57a3ab-b378-4d66-9ae3-34d68a114981`, prefix `KEE`). Do not use it.
- Plan: `docs/HANDOFF.md`

## Key Decisions

- 2026-10-11: RF-352. A signed-in plan stores its proposer outcome on the appliance (`proposal_fallback`, `proposal_search_outcome`, `proposal_search_reason`, `proposal_searched`). A reload shows that same banner. Rows without those values stay null and the plan page shows a neutral banner, never "no manual found". The owner applies `20261011120000_proposal_meta.sql` on hosted Supabase before the app that sends the new `add_appliance` arguments is deployed.
- 2026-10-11: RF-349. Keeply-funded AI is MiniMax when configured, otherwise OpenRouter (`OPENROUTER_API_KEY`, default model `openrouter/free`, `data_collection` deny unless `OPENROUTER_DATA_COLLECTION=allow`). A saved BYO MiniMax key still comes first. Manual still always works. The model's output stays a proposal. Pinned `google/gemma-4-31b-it:free` returned 429 on every live call the same day, so the default is the free router.
- 2026-10-11: RF-344. A manual cover that names the same product family is Similar-model guidance, never Manufacturer verified. An exact copy on a third-party site stays Similar-model with the third-party wording (owner, 2026-10-11). An HTML cover is the page title plus the first 2,000 characters of extracted text; PDF covers stay pages 1–2.
- 2026-10-11: Linear is the tracker (Keeply project, Engineering/RF); Codex plans and reviews, Cursor implements. Paperclip will not be used, which supersedes the 2026-10-04 exception and the 2026-10-06 retrial rule. Shared skills and grill-with-docs land with the workflow setup; cloud automation and auto-merge stay off.
- Registered 2026-10-04. Scope follows `docs/HANDOFF.md`: dishwashers only, Phase 0 + 1 first, no AI recognition until the approval/calendar skeleton works.
- Agent team in Paperclip until 2026-10-05 (superseded below): CEO, CTO, CFO on Opus 5.5 (`claude-opus-5-5`); Builders 1–2 on Sonnet 5.5 (`claude-sonnet-5-5`); Builders 3–4 on Codex (`gpt-5.6-sol`, medium). The Codex model was set as the closest match to "Sol 6.1"; confirm.

## Constraints

- Free-tier infrastructure (Vercel, Supabase) during validation; no subsidised AI for beta users.

## Durable Outcomes

- 2026-10-06: **Paperclip parked** by the owner (all five agents paused, heartbeats off, backup `~/.paperclip/instances/default/data/backups/paperclip-20261006-180846.sql.gz`). Why: stalls and lockouts (KEE-55, KEE-60) needed repeated rescue; the MiniMax Builder finishes work but cannot reliably hand off, and the overhead outweighed the token savings at this project size. Work now goes through direct sessions, GitHub PRs and CI. The 2026-10-11 decision supersedes the old retrial rule: Paperclip will not be used.
- 2026-10-06: Paperclip team reset to a lean setup: Lead and Builder active; Researcher, UX, UI paused until a ticket needs them; CEO, CFO, Intern retired. Lead on Claude Sonnet 5.5 (`claude_local`, from 2026-10-06; judgment role, uses the owner's Claude plan), all other agents on MiniMax-M3 (`hermes_local`); Paperclip budgets are set ($25/month company, $10 Lead/Builder, $5 others) but are inactive: they only measure `billed_cents`, and the MiniMax Token Plan bills 0, so they cap nothing unless an agent moves to a metered API. Real limits are the plan's 5-hour/weekly windows and keeping heartbeats off and three roles paused. Matt Pocock skills `v1.2.3` attached by role. Why: the first team spent tokens on coordination and passed CI while four core bugs were live; guardrails now live in each ticket's execution policy.
- 2026-10-05: scan limits are set in Supabase: 3 scans per user per UTC day and 100 in total; the owner's invite is `unlimited` (migration `20261005130000_scan_unlimited.sql`). Scanning is on in Production (`NEXT_PUBLIC_KEEPLY_SCAN=1`); `SUPABASE_SERVICE_ROLE_KEY` is still not set in Vercel (owner action).
- 2026-10-05: owner authorised hosted BYO MiniMax API-key settings (KEE-47), overriding the earlier no-consumer-key-entry restriction. Keys are encrypted server-side per signed-in user; invite limits remain 5/user/day and 100/day. Appliance identification only; no silent fallback from a personal key to app-funded AI. See HANDOFF §25.

- 2026-10-04: owner chose the full magic-minute flow as the finish line, with Brave Search + MiniMax manual reading and "verified only with a code-checked quote from the manufacturer's document". Invited testers get funded AI behind an invite code (5/tester/day, 100/day total). Details: `docs/HANDOFF.md` §23.
- 2026-10-04: owner cut the build to the MVP: photo → identify → plan → Accept / Reject → Google Calendar, managed there. Supabase keeps only appliances, tasks and usage counts; Customise, completions, pause, catalog and photo storage were removed (`docs/HANDOFF.md` §24).
