# Agents — Keeply

## Identity

Route here for work on Keeply (`active/Keeply/`). Outcome: a mobile-first PWA where a user photographs a dishwasher and, in about a minute, gets an evidence-labelled maintenance plan, accepts or rejects each task, and has only the accepted tasks written to Google Calendar, where the owner manages them. Working name; branding is an open decision.

## Source of Truth

- GitHub repo: https://github.com/FilhoRicardo/keeply
- Issue tracker: Paperclip, not Linear (project decision 2026-10-04). Project "Keeply v0.1" (`fa36ca0b-e4ca-4c61-a7b2-2fab949407de`); current issue KEE-1 (Phase 0 + 1 skeleton).
- Paperclip company: Keeply (`7a57a3ab-b378-4d66-9ae3-34d68a114981`, issue prefix `KEE`) owns scope, issues and the agent team. Org: CEO → CTO + CFO; CTO → Builders 1–4.
- Planning source: `docs/HANDOFF.md` is the authoritative plan (equivalent of `PLAN.md`). Do not expand scope beyond it without a clear reason.
- Claude may implement authorised work directly; the separate critic-only planning role and mandatory review log are retired workspace-wide.

## Resources

| Resource | Read when... |
|---|---|
| `docs/HANDOFF.md` | Starting any substantive work: scope, evidence model, data model, build order. |
| `CONTEXT.md` | Using or naming domain terms (evidence levels, recommendation vs task). |
| `/Users/ricardofilho/Documents/Projects/resources/branding/aster/BRAND.md` | Building UI, unless a Keeply brand is later chosen (the handoff lists branding as open). |

## Non-negotiables (from the handoff)

1. AI proposes; the owner approves. Nothing is written to a calendar before explicit approval.
2. Never present inferred or general guidance as manufacturer-verified. Keep the three evidence levels visibly distinct.
3. Never rewrite what a source recommends: the owner only accepts or rejects each proposed task (MVP decision 2026-10-04, `docs/HANDOFF.md` §24).
4. After Approval the owner manages tasks in their calendar; Keeply does not track completions or reschedule (§24 replaces the earlier completion-based rule).
5. AI is never the authoritative source for maintenance intervals; provenance is first-class data.
6. Dishwashers only. Mobile-first. Keep infrastructure near €0 (Vercel + Supabase free tiers).
7. AI access goes through a provider layer (ChatGPT-authorized / BYO API key / Keeply-hosted / manual) that is separate from Keeply account authentication; Manual must always work. See `docs/HANDOFF.md` §22.
8. **ChatGPT integration: research first.** Before writing any code for Sign in with ChatGPT, research the current official OpenAI documentation and return an implementation plan with links to it. Do not code that portion until the capability and requirements are verified. Never treat it as ordinary OAuth, a key-paste flow, or social login, and never expose OpenAI credentials client-side.

## Workflow

1. Read this file, `MEMORY.md`, and `docs/HANDOFF.md` before touching code.
2. Current milestone: the MVP in `docs/HANDOFF.md` §24 (photo → AI identification → plan found → Accept / Reject → Approval → Google Calendar). Next: manual search (Phase 3, §23).
3. Query `codebase-memory-mcp` (`search_graph`, `trace_path`, `get_architecture`) before broad code exploration, once code exists and is indexed.
4. Non-trivial code work gets a Paperclip issue first (`KEE-n`); branches and PRs reference it.
5. Verify with the checks below.
6. Update `MEMORY.md` only when durable context changes.

## Verification

Run `pnpm verify` (= `pnpm typecheck && pnpm lint && pnpm test && pnpm build`) before reporting done; add `supabase test db` for schema work. Module layout: `docs/architecture.md`.
