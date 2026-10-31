# Hosted personal MiniMax keys — KEE-47

> **Historical (RF-357).** Hosted BYO MiniMax keys, `/settings/ai`, `/api/ai-key`, and `ai_credentials` were removed. Do not follow this as a current setup guide.

This implements HANDOFF §25. A signed-in Keeply user can save, replace or remove a personal MiniMax API key at `/settings/ai`. Google sign-in identifies the owner; it grants no AI usage. The user pays MiniMax directly. Manual entry remains available.

## Security and behavior

- Requests use the caller's Supabase bearer session. The server verifies the user with `auth.getUser()` and rejects anonymous credential access. The browser cannot choose the stored user ID.
- Keys are encrypted with AES-256-GCM and a fresh random nonce; authenticated data binds ciphertext to the user and provider. Only the server's service-role client can read or write the ciphertext table. Public and authenticated clients have no table grants.
- GET returns status only, never a key or ciphertext. Mutation requests must have the same origin; input and body sizes are bounded. Responses are not cached. Keys are not saved to browser storage, URLs, analytics or logs.
- Personal keys use the existing provider layer, fixed MiniMax endpoint and model. A personal-key error does not retry with the server key. An unreadable stored credential fails closed rather than charging Keeply.
- Invites and atomic scan reservations remain required. Limits count billable attempts, including failures: 5 per user and 100 globally per UTC day. These limits are not monetary spending caps.
- MiniMax Token Plan keys (`sk-cp-…`) are refused in this hosted feature. MiniMax describes that plan as individual, interactive developer use ([official plan page](https://platform.minimax.io/subscribe/token-plan)). Users must arrange provider access permitted for their use and provider spending controls.
- AI output is still only appliance identity. Confirm / Edit / Rescan is unchanged. This does not add maintenance-plan AI or source retrieval.

## Deployment

1. Review and apply `supabase/migrations/20261005110000_ai_credentials.sql` to the target Supabase project. It adds a service-only table; existing plans and invites are unaffected.
2. Configure `SUPABASE_SERVICE_ROLE_KEY` as a server-only Secret in the intended Vercel environment. Enter it directly into Vercel, never chat or source control.
3. Generate a random 32-byte encryption key, base64-encode it, and save as server-only Secret `KEEPLY_AI_KEY_ENCRYPTION_KEY`. Keep a secure backup separate from the database. Never prefix either secret with `NEXT_PUBLIC_`.
4. Enable `NEXT_PUBLIC_KEEPLY_SCAN=1` and redeploy only after credential storage, invitations and counters are ready. BYO does not require an app `MINIMAX_API_KEY`.
5. Keep Production's app-funded MiniMax key unset until suitable provider access is arranged. The existing owner Token Plan key belongs only in the protected Preview.

Changing the encryption key without migrating existing ciphertext makes saved credentials unreadable. Users can remove and resave their keys; do not silently fall back to app funding. Removal deletes the active row; database backups follow Supabase's retention policy. Users can also revoke a key at MiniMax.

## Live verification before inviting testers

Use a non-production test account first. Sign in, save a permitted test key, reload and confirm only a saved/not-saved status is returned. Verify another account cannot read, replace or delete its credential. Redeem an invite and perform one real label scan; the remaining count drops by one and nothing is saved before confirmation. Provider failure must fall back to manual without using the hosted key. Remove the key and verify no subsequent request uses it. Verify production Google Calendar still adds only explicitly approved, accepted tasks.

Automated tests cover encryption tampering and owner binding, credential CRUD/authentication/CSRF, provider precedence and failure, database grants, existing quota invariants and mobile UI. They do not prove a user's real provider credentials, billing limits or terms eligibility.
