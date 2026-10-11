# Shared skills

Upstream: https://github.com/mattpocock/skills
Pinned commit: 49dd158d1076134a641b33efb035946536778336
Installed: 2026-10-11
Location: `.agents/skills/`, available to both Codex and Cursor.

Included: grill-me, grilling, grill-with-docs, domain-modeling, to-spec, to-tickets, implement, tdd, code-review, codebase-design. Whole skill directories include their reference files. Upstream skill contents are unchanged; Keeply adaptations live in AGENTS.md and docs/agents/.

When a runtime has no Skill tool, explicitly read the named SKILL.md and its required dependencies/references and carry out its instructions using that runtime's tools. Do not assume slash-command or subagent support is identical across runtimes. Start a fresh Codex turn to discover installed skills.
