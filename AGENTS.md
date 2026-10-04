# Agents — Keeply

## Identity

Route here for work on Keeply (`active/Keeply/`). Outcome: a mobile-first PWA where a user photographs a dishwasher and, in about a minute, gets an evidence-labelled maintenance plan, approves or customises it, and has only the approved tasks written to Google Calendar. Working name; branding is an open decision.

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
3. Store the manufacturer recommendation separately from the user's chosen schedule. Never rewrite the former.
4. Model completion-based scheduling in the data model from day one.
5. AI is never the authoritative source for maintenance intervals; provenance is first-class data.
6. Dishwashers only. Mobile-first. Keep infrastructure near €0 (Vercel + Supabase free tiers).

## Workflow

1. Read this file, `MEMORY.md`, and `docs/HANDOFF.md` before touching code.
2. Current milestone: Phase 0 + Phase 1 only (manual dishwasher, three mock recommendations, Include / Customise / Skip, approval, Google Calendar). No AI recognition yet.
3. Query `codebase-memory-mcp` (`search_graph`, `trace_path`, `get_architecture`) before broad code exploration, once code exists and is indexed.
4. Non-trivial code work gets a Paperclip issue first (`KEE-n`); branches and PRs reference it.
5. Verify with the checks below.
6. Update `MEMORY.md` only when durable context changes.

## Verification

None yet — no code exists. Set the verify command (typecheck, tests, build) when Phase 0 lands.
