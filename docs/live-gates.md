# Live gates (operator checklist)

Use this file on **your** deployment to record what you verified against real Supabase, Google Cloud, and your hosted URL. The open-source repo does not ship owner-specific gate evidence; copy this template into your ops notes or a private repo if you need a long-lived audit trail.

Automated checks (unit, pgTAP, PostgREST integration, phone e2e) run in CI on every pull request. Live gates are manual: sign-in, calendar write, optional AI scan, and isolation between visitors.

## Template

| Gate | Date | Evidence |
|---|---|---|
| Database schema | | Migrations applied; anon can reach the API |
| Anonymous session | | Appliance persists after reload |
| Google Calendar | | Approval creates expected recurring event |
| Sign in with Google | | Manual linking keeps anonymous data |
| Visitor isolation | | Other users cannot open foreign appliance URLs |
| AI scan (optional) | | Label read or honest fallback when keys unset |

Fill rows as you verify your environment. See `docs/self-host.md` for setup and `docs/live-testing.md` for scripted checks.
