# Agents — Keeply

## Identity

Route here for work on Keeply (`active/Keeply/`). Outcome: a mobile-first PWA where a user photographs a household appliance and, in about a minute, gets an evidence-labelled maintenance plan, accepts or rejects each task, and has only the accepted tasks written to Google Calendar, where the owner manages them. Working name; branding is an open decision.

## Source of Truth

- GitHub repo: https://github.com/FilhoRicardo/keeply
- Issue tracker: [Software Development Tickets database in Notion](https://app.notion.com/p/1bf0645bd54e4630b476b0b5a360d820), filtered to the Keeply project. Notion owns specifications, tickets, dependencies and status; GitHub owns code and PRs. Linear was the tracker until 2026-11-01; its RF ids are kept as legacy Ticket IDs.
- Planning source: `docs/HANDOFF.md` preserves existing product decisions. New agreed scope is captured in Notion. Historical Paperclip records are context only. Paperclip is not in use and must not be started.
- Roles: Codex plans and reviews; Cursor implements approved tickets. Claude is reserved for professional/business work unless Ricardo explicitly assigns another role.

## Agent skills

- Shared upstream skills live in `.agents/skills/`. Source and pinned revision: `docs/agents/skills-source.md`.
- Issue tracker operations and ticket lifecycle: `docs/agents/issue-tracker.md`.
- Mandatory planning and dispatch gate: `docs/agents/workflow.md`.
- Domain documentation: `docs/agents/domain.md`.

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
6. Any household appliance (widened from dishwashers only by Ricardo, KEE-59, 2026-10-06). Without a manufacturer manual only dishwashers get the built-in general list. Mobile-first. Keep infrastructure near €0 (Vercel + Supabase free tiers).
7. AI access goes through a provider layer (ChatGPT-authorized / BYO API key / Keeply-hosted / manual) that is separate from Keeply account authentication; Manual must always work. See `docs/HANDOFF.md` §22.
8. **ChatGPT integration: research first.** Before writing any code for Sign in with ChatGPT, research the current official OpenAI documentation and return an implementation plan with links to it. Do not code that portion until the capability and requirements are verified. Never treat it as ordinary OAuth, a key-paste flow, or social login, and never expose OpenAI credentials client-side.

## Workflow

1. Read this file, `MEMORY.md`, and `docs/HANDOFF.md` before touching code.
2. Current state: the MVP (§24) and manual search (§23) are built. A demo deployment may exist separately from this repo; self-hosters follow `docs/self-host.md`. Where each setting lives: `docs/environments.md`.
3. Query `codebase-memory-mcp` (`search_graph`, `trace_path`, `get_architecture`) before broad code exploration, once code exists and is indexed.
4. Follow `docs/agents/workflow.md`: mandatory `grill-with-docs`, confirmed scope, ticket, branch, PR, independent Codex review, then merge. Preserve the existing human approval requirement for production, schema, secrets, or a calendar/email send. Done requires a real-input browser run with evidence and a merged PR.
5. Verify with the checks below.
6. Update `MEMORY.md` only when durable context changes.

## Verification

Run `pnpm verify` (= `pnpm typecheck && pnpm lint && pnpm test && pnpm build`) before reporting done; add `supabase test db` for schema work. Module layout: `docs/architecture.md`.

## Code Review Rules

- Check the linked Notion ticket's acceptance criteria and agreed test seams as well as repository standards.
- Preserve explicit owner approval before calendar writes, evidence provenance, credential isolation, and usage limits.
- Require passing relevant checks and real-input evidence for changed user flows. A lack of review comments is not merge approval.
