# Agents — Keeply

## Identity

Route here for work on Keeply (`active/Keeply/`). Outcome: mobile-first PWA — photo an appliance, get an evidence-labelled maintenance plan in ~1 minute, accept or reject each task, write only accepted tasks to Google Calendar. Branding open.

## Source of Truth

- GitHub repo: https://github.com/FilhoRicardo/keeply
- Issue tracker: [Software Development Tickets database in Notion](https://app.notion.com/p/1bf0645bd54e4630b476b0b5a360d820), filtered to the Keeply project. Notion owns specifications, tickets, dependencies and status; GitHub owns code and PRs. Linear was the tracker until 2026-11-01; RF-xxx and OSS-xx ids are kept as legacy Ticket IDs.
- Planning source: `docs/HANDOFF.md` preserves existing product decisions. New agreed scope is captured in Notion. Historical Paperclip records are context only. Paperclip is not in use and must not be started.
- Roles: Codex plans and reviews; Cursor implements approved tickets. Claude is reserved for professional/business work unless Ricardo explicitly assigns another role.

## Agent skills

- Shared upstream skills live in `.agents/skills/`. Source and pinned revision: `docs/agents/skills-source.md`.
- Issue tracker, workflow gate, domain: `docs/agents/issue-tracker.md`, `docs/agents/workflow.md`, `docs/agents/domain.md`.
- Handoffs: `.agents/skills/handoff/SKILL.md`.

## Resources

| Resource | Read when... |
|---|---|
| `docs/HANDOFF.md` | Scope or product rules: use its index; read only relevant sections. |
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
8. **ChatGPT integration: research first** (`docs/HANDOFF.md` §22). No code until official OpenAI docs are verified; never ordinary OAuth or client-side credentials.

## Workflow

1. Read this file. Read only the `docs/HANDOFF.md` section(s) relevant to the task (use its index). Read `MEMORY.md` only when planning or when the task touches a gate it lists.
2. Current state: the MVP (§24) and manual search (§23) are built. A demo deployment may exist separately from this repo; self-hosters follow `docs/self-host.md`. Where each setting lives: `docs/environments.md`.
3. Query `codebase-memory-mcp` before broad code exploration when indexed.
4. Follow `docs/agents/workflow.md`: `grill-with-docs` for planning/new scope only; scoped tickets → confirmed spec/ticket, branch, PR, Codex review, merge. Human approval for production, schema, secrets, calendar/email sends. Done = real-input browser evidence + merged PR.
5. Verify with the checks below.
6. Update `MEMORY.md` only when durable context changes.

## Context budget

- One scoped task per thread; start a fresh thread instead of steering a derailed one.
- At the first context compaction or when re-fetching the same file twice, stop and write a handoff (`.agents/skills/handoff/SKILL.md`).
- Prefer pointers over pasting file, spec, or ticket contents.
- Codex: medium effort, no Fast mode, no nested subagents.

## Verification

Run `pnpm verify` (= `pnpm typecheck && pnpm lint && pnpm test && pnpm build`) before reporting done; add `supabase test db` for schema work. Module layout: `docs/architecture.md`.

## Code Review Rules

- Check the linked Notion ticket's acceptance criteria and agreed test seams as well as repository standards.
- Preserve explicit owner approval before calendar writes, evidence provenance, credential isolation, and usage limits.
- Require passing relevant checks and real-input evidence for changed user flows. A lack of review comments is not merge approval.
