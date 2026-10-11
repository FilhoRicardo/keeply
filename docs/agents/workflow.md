# Keeply agent workflow

## Planning gate

Before new project scope or any independently scoped implementation ticket is released, Codex runs `grill-with-docs` with Ricardo. It combines `grilling` (also used by `grill-me`) and `domain-modeling`; do not repeat the same interview twice. Research factual questions rather than asking Ricardo to supply discoverable facts.

Resolve the outcome, boundaries, acceptance criteria, dependencies, test seams and material tradeoffs. Ricardo, or a proxy he explicitly authorizes to answer planning questions, confirms shared understanding. Record the confirmation, any delegation and its scope, and the spec revision it covers in Linear. Proxy decisions must be attributed to the proxy; delegation to plan does not grant production, secret, schema, calendar/email, merge, or deployment approval. Use `to-spec` and `to-tickets` for the agreed scope. Child tickets inherit this gate from their confirmed parent spec. Reopen it if material requirements change or unresolved design decisions emerge.

This workflow setup is already authorized in the conversation; it does not authorize new Keeply product features.

## Dispatch gate

The intended trigger is a transition to Todo, with ready-for-agent present. Before starting, verify the Keeply project/repository mapping, linked confirmed spec, acceptance criteria, agreed test seams, completed blockers and absence of an active worker or existing implementation PR. A label alone is insufficient. Until an automation verifies these conditions, dispatch is manual.

Backlog means planning or blocked work. In Progress means implementation. In Review means a linked PR exists. Done means review and verification succeeded and the PR merged.

## Implementation and review

Cursor uses `implement` and `tdd` for one scoped ticket on a branch. Include the RF identifier and Linear URL in the PR. Run the repository's required verification and provide real-input browser evidence where relevant.

Codex uses `code-review` against the base branch and linked spec, covering Standards and Spec independently. Native subscription-based GitHub review is an additional serious-issue check, not proof of full skill execution or acceptance.

Merge only with an explicit passing review of the current commit and required CI passing. New commits invalidate review clearance. Preserve human approval for production/schema/secrets/calendar or email sends; merging main can deploy production. Unattended merging remains disabled until enforceable gates are configured and validated.

## Budget and activation

Use Codex signed in with ChatGPT; no OpenAI API key or API-backed Action. Cursor uses its separate subscription and cloud allowance, which must be verified before automation is enabled. Start with one worker and at most two automatic repair rounds, then escalate. Automation setup/validation is tracked in RF-338. No worker automation is enabled by these files.

## Final step: /retro

At the end of each completed work cycle or session, after verification and any authorized delivery/status updates, invoke `retro` as the final workflow step before reporting back. Read its `writing-for-agents` dependency and the session evidence. Present concrete environment/workflow improvements ranked by severity, or explicitly report no actionable findings. A planning-only or blocked session may run a retro of that session; it must not imply implementation or delivery finished. Proposed retro improvements become separate follow-up work unless already authorized.
