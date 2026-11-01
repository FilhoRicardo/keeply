# Security

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security bugs.

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/FilhoRicardo/keeply/security/advisories/new) on this repository. We will acknowledge and work with you on a fix.

## Secrets

Never commit API keys, OAuth secrets, service-role keys, or other credentials. Use `.env.local` (gitignored) and your host's secret store. See `.env.example` for variable names only.
