# Issue tracker

- Tracker: Notion, Software Development area, Tickets database: https://app.notion.com/p/1bf0645bd54e4630b476b0b5a360d820
- Project: Keeply row in the Projects database: https://app.notion.com/p/40b4bb824eeb81ef92f3f3547bcf7d9a
- GitHub: https://github.com/FilhoRicardo/keeply
- Legacy: Linear (Keeply project, Engineering/RF) until 2026-11-01. RF-338..RF-357 were migrated; each keeps its RF id in the Ticket ID property. The Linear snapshot page is history only. Do not create or update Linear issues.

Use the Notion tools for scope, specs and tickets. Fetch the full ticket page (body and comments) before implementation/review. Every Keeply ticket links the Keeply project. Publish dependent tickets in dependency order using the Blocked by relation (Blocks is its reverse). Do not duplicate the backlog in GitHub Issues. Do not use Paperclip.

Fields: Title, Project, Status, Type (Tracer bullet, Bug, Chore), Blocked by, Branch, PR URL, Ticket ID (legacy RF id; empty for new tickets).

Create work in Backlog. Only after the workflow planning gate passes may a ticket move to Ready. `to-spec` and `to-tickets` upstream readiness defaults are subordinate to this project gate. Do not invent or add Status or Type options automatically.

New tickets have no RF id: refer to them by Notion page title and link. Migrated tickets keep their RF id in branches and PRs. Link the spec and the Notion ticket page directly in the PR body, and set Branch and PR URL on the ticket. Move to In review when the PR exists, and Done only after merge and verification.
