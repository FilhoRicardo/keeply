---
name: handoff
description: Write a compact handoff when context is exhausted or work must continue in a fresh thread. Use at first compaction, when re-reading the same file twice, or before switching harness or directory.
---

Write a **handoff document** so a fresh agent can continue without re-reading the whole conversation. Save to `.agents/handoffs/<YYYY-MM-DD>-<slug>.md` (slug = short kebab-case task name). Create the directory if needed.

## Document shape (under 300 words)

Use markdown with these headings:

1. **Goal** — what success looks like for the next session.
2. **Current state** — what is done, in flight, or blocked (facts only; downgrade unverified claims).
3. **Branch / PR / HEAD** — branch name, PR URL if any, `git rev-parse HEAD` SHA.
4. **Links** — Notion ticket, spec, and PR URLs; paths to key files. **Do not copy** spec, ticket, diff, or HANDOFF text.
5. **What's left** — ordered next steps.
6. **Gotchas** — constraints, failed approaches, env gates, review state.
7. **Suggested skills** — which `.agents/skills/*/SKILL.md` files the next agent should read.

Redact secrets (keys, tokens, passwords, PII). If the user gave a focus for the next session, tailor the doc to that.

After writing, tell the user the absolute path and that the folder is gitignored.
