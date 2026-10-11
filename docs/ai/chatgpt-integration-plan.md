# Sign in with ChatGPT: research findings and implementation plan

Status: **research only, no code** (per `docs/HANDOFF.md` §22 and `AGENTS.md` rule 8). Researched 2026-10-04.

**How this was researched:** the cloud session that wrote this could not open `developers.openai.com` or `help.openai.com` (blocked by its network policy). Findings come from OpenAI's own pages as quoted by web search, restricted to openai.com domains. Before coding, someone with normal network access must read the linked pages in full and confirm each item marked *(confirm)*.

## Verified 2026-10-11 (pages read in full, normal network access)

These replace the *(confirm)* items below where they differ.

- **Plan usage needs a loopback callback.** The open-source flow (the only documented way to use a user's ChatGPT plan) registers `http://127.0.0.1:<port>/auth/callback`; "only the port may vary" and "Do not substitute with `localhost`". The user's browser must reach a Keeply running on their own computer. A public site such as `keeply.vercel.app` cannot use this flow. ([Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in))
- **Hosted website integration is identity only**, in a limited trial: "Sign in with ChatGPT is currently available to selected commercial partners through a limited trial." It uses an `oaiapp_` client ID and scopes `openid profile email`; plan usage "has a separate authorization and registration flow". ([On your website](https://developers.openai.com/siwc/website))
- **Paid or remotely hosted apps** that want plan usage: "complete the interest form". ([Overview](https://developers.openai.com/siwc/token-sharing-open-source), [interest form](https://openai.com/form/sign-in-with-chatgpt-interest/))
- **Scopes and resource** for plan usage: `offline_access resource.invoke chatgpt.tokens.use.direct`, resource `https://api.openai.com/v1`; check `chatgpt.tokens.use.direct` was granted before inference. Per-host `ext_agent_host_id`; issued `client_id` saved per ChatGPT account. ([Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in))
- **Inference:** `POST https://api.openai.com/v1/responses` with `Authorization: Bearer <access token>`, `store: false`, `stream: true`; models from `GET /v1/models` (`visibility == "list"`). Limit errors arrive as `subscription_sharing_usage_limit_exceeded` / `subscription_sharing_usage_unavailable`. ([Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference))
- **Images are supported**: "Text, images, and files are supported when the selected model accepts them." Not supported on this route: the Files upload API, `temperature`, `max_output_tokens`, `metadata`, `user`, system-role items (use `instructions`). ([Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations))
- **User plans:** Plus and Pro per the developer quickstart; OpenAI's help search snippet also names Go. Users can set a weekly per-app limit in Settings → Usage. ([Quickstart](https://developers.openai.com/siwc/quickstart), [help](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites))
- Not readable from this machine (HTTP 403): the help article body and the [terms](https://openai.com/policies/sign-in-with-chatgpt-terms/). Read them before launch.

**Consequence for Keeply:** the hosted app cannot use ChatGPT plan usage until OpenAI accepts it through the interest form (provider A2 below). Self-hosted, run-on-your-own-computer Keeply (A1) is technically possible now. Hosted users need another provider (B/C) or Manual (D) in the meantime.

## Primary sources

- Product overview: [Sign in with ChatGPT](https://developers.openai.com/siwc) · [Quickstart](https://developers.openai.com/siwc/quickstart)
- Hosted website integration: [On your website](https://developers.openai.com/siwc/website)
- Open-source / local apps: [Overview](https://developers.openai.com/siwc/token-sharing-open-source) · [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) · [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) · [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) · [Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference) · [Self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)
- Cookbook: [Integrating Sign in with ChatGPT in your open-source app](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)
- User-facing help: [Sign in with ChatGPT](https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt) · [Using your ChatGPT plan in other apps and sites](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites)
- Terms: [Sign in with ChatGPT Terms](https://openai.com/policies/sign-in-with-chatgpt-terms/)

## The eight questions

**1. Can third-party apps use user-authorized ChatGPT-plan usage?** Yes, as an optional permission separate from sign-in: "ChatGPT plan usage is an optional permission to complete eligible AI requests with usage included in the user's ChatGPT plan or available credits." It "does not grant access to their ChatGPT conversations or other account context." Availability at launch: "open-source projects, personal projects that run locally, and selected private apps." ([siwc](https://developers.openai.com/siwc), [open-source overview](https://developers.openai.com/siwc/token-sharing-open-source))

**2. Eligibility.**
- *Users:* anyone can sign in, but "the option to use your ChatGPT plan is only available with Plus and Pro." Signing in and sharing allowance are separate choices; the app can use the allowance only after the user approves. ([help](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites))
- *Apps:* open-source tools and local personal projects can use plan usage now. "If you're building a paid or remotely hosted app, you should join the waitlist to request access before offering it to users." The hosted website integration "is currently available to selected commercial partners through a limited trial." ([open-source overview](https://developers.openai.com/siwc/token-sharing-open-source), [website](https://developers.openai.com/siwc/website))
- **For Keeply:** the hosted site on Vercel is a *remotely hosted app* → needs OpenAI's approval (waitlist / interest form) before offering plan usage. A self-hosted open-source Keeply can use the open-source flow now *(confirm how "run locally" applies to a self-hosted web app, see [Self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms))*.

**3. Client ID / approval.**
- *Website (hosted):* "You need an OpenAI client ID (typically beginning with `oaiapp_`), an exact registered callback URL for each environment", the issuer's authorization, token and JWKS endpoints, and the registered token-endpoint auth method; confidential clients keep `OPENAI_CLIENT_SECRET` server-side, public clients have no secret. Issued through the partner programme. ([website](https://developers.openai.com/siwc/website))
- *Open-source:* dynamic registration. First sign-in uses `client_id=dynamic_agent_client` with the app name in `agent_name_hint` and an app-generated `ext_agent_host_id`; OpenAI then issues a `client_id` bound to that user and workspace, reused on later sign-ins. ([registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in))

**4. Authorization flow.** Authorization Code with PKCE (S256) and OpenID Connect. Backend generates `state`, PKCE verifier, challenge and `nonce`, bound to a server-side browser session. Token exchange: form-encoded `authorization_code` grant to `https://auth.openai.com/api/accounts/oauth/token` with the issued `client_id`, `code`, `code_verifier`, the same `redirect_uri` and `resource`; no client secret on the open-source flow. ([website](https://developers.openai.com/siwc/website), [registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)) *(confirm authorization endpoint URL and the exact `resource` value)*

**5. Scopes and privacy.** Identity scopes; `offline_access` for a refresh token; `resource.invoke` with `chatgpt.tokens.use.direct` for plan usage. No access to the user's conversations. Keep only the identity mapping you need; don't keep raw ID tokens after verification. ([open-source](https://developers.openai.com/siwc/token-sharing-open-source), [website](https://developers.openai.com/siwc/website)) *(confirm full scope list in the [token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference))*

**6. Usage limits and user controls.** Included usage first, then the user's purchased credits. Users choose which apps may use their allowance, can "set an app-specific limit", and manage access in ChatGPT Settings → Usage; apps should link there. For Plus, "the five-hour usage limit is shared across all apps." ([help](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites), [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference))

**7. Models / endpoints.** "Use the public Responses API endpoint for this ChatGPT plan usage flow, and use a model available to the signed-in account." ([models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)) *(confirm whether image input, needed for label photos, is supported)*

**8. Fit for Keeply's commercial/open-source architecture.** Good fit for the provider layer in HANDOFF §22, with two variants of provider A:
- **A1 — open-source/self-hosted Keeply:** dynamic-client flow, available now for local/self-hosted use.
- **A2 — hosted keeply (Vercel):** needs partner approval and an `oaiapp_` client ID; until then hosted users fall back to D (manual) or a future C.
Constraints that match ours: credentials server-side only, HttpOnly/Secure/SameSite=Lax session cookie, no tokens or verifier in browser JS. Commercial terms *(confirm in the [terms](https://openai.com/policies/sign-in-with-chatgpt-terms/))*.

## Implementation plan (when approved to build)

0. **Owner action now:** submit OpenAI's interest form / waitlist for the hosted Keeply app (A2). Ask: image input via plan usage, commercial use, data retention.
1. **Provider layer first (no OpenAI calls):** `AiProvider` interface (`recogniseLabel`, later `extractMaintenance`), selected per request on the server from: ChatGPT authorization present (A) → server BYO key configured (B) → Keeply-hosted key + entitlement (C) → manual (D). Separate from Supabase auth; manual always available. Done 2026-10-04: `src/ai/provider.ts` (server-only), Manual only; `/api/identify` uses `selectProvider`.
2. **B (BYO key, self-hosted):** `OPENAI_API_KEY` env only, Responses API with structured output for label recognition; output is a proposal the owner confirms. No key-paste UI.
3. **A1 (open-source ChatGPT plan usage):** server-side PKCE flow with dynamic registration, encrypted token storage (Supabase table, service-role only, per Keeply user), refresh via `offline_access`, link to ChatGPT Settings → Usage, clear "using your ChatGPT plan" consent copy and a disconnect action.
4. **A2 (hosted):** only after OpenAI issues a client ID; same server code with the issued client ID and registered callback per environment.
5. **Tests:** provider selection order; manual fallback whenever A/B/C fail; no credential ever in client bundles (build-time check); token encryption at rest.

Nothing above changes Keeply's rules: AI proposes, the owner approves; evidence levels are still enforced by `unsupportedEvidence` and the database.
