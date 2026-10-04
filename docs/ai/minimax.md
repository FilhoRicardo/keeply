# MiniMax appliance-identification provider

Status (2026-10-04): **adapter implemented; live verification pending.** All tests use mocks or a local stand-in server, not MiniMax. Real calls happen only when `MINIMAX_API_KEY` is set on the server (and scanning is enabled); otherwise Keeply stays in Manual mode.

Code: `src/ai/minimax.ts` (all MiniMax request/response handling), `src/ai/identity.ts` (Keeply's neutral schema `applianceType, manufacturer, model, serialNumber, confidence`), `src/ai/provider.ts` (selection; Manual always last). Workflow: photo → `/api/identify` → provider → neutral identity → Confirm / Edit / Rescan. Nothing is saved without the owner confirming; any edit drops the AI confidence. Only photos the browser re-encoded (EXIF/GPS dropped) are sent.

## Account

Ricardo: **MiniMax Token Plan, model MiniMax-M3** (non-secret account info; the key itself is never pasted into chat).

## What is confirmed, and how

The cloud session could not open MiniMax's docs (network policy), so everything below comes from MiniMax's own pages **as quoted by web search**. Treat it as unverified until someone reads the pages in full.

| Claim | Source (search excerpt) | Applies to |
|---|---|---|
| OpenAI-compatible Chat Completions at `https://api.minimax.io/v1/chat/completions` | [Chat Completions API](https://platform.minimax.io/docs/api-reference/text-chat-openai), [OpenAI SDK](https://platform.minimax.io/docs/api-reference/text-openai-api) | general API |
| Image input via `image_url` content parts on **MiniMax-M3** and MiniMax-M3.1-Flash-Preview; the **M2.x series is text-only** | [Chat Completions API](https://platform.minimax.io/docs/api-reference/text-chat-openai) | model capability |
| Images JPEG/PNG/GIF/WEBP, ≤10 MB; base64 data URI accepted | [Chat Completions API](https://platform.minimax.io/docs/api-reference/text-chat-openai) | general API |
| Thinking on by default; `thinking: {type: "disabled"}`; `reasoning_split` moves reasoning out of `content` (else `<think>` tags) | [Chat Completions API](https://platform.minimax.io/docs/api-reference/text-chat-openai) | general API |
| Token Plan keys start `sk-cp-`; OpenAI-compatible base URL `https://api.minimax.io/v1`, model ID `MiniMax-M3` | [Token Plan quick start](https://platform.minimax.io/docs/token-plan/quickstart), [Other tools](https://platform.minimax.io/docs/token-plan/other-tools) | **Token Plan** |
| Token Plan: one shared quota across capabilities; image understanding ("API-vlm") deducts from it; 5-hour rolling + weekly windows; RPM/TPM throttling | [Token Plan FAQ](https://platform.minimax.io/docs/token-plan/faq), [Token Plan overview](https://platform.minimax.io/docs/token-plan/intro) | **Token Plan** |
| Token Plan "provides coverage for the full MiniMax lineup including M3, M2.7, image, and speech models" (a few special models excluded) | [Token Plan overview](https://platform.minimax.io/docs/token-plan/intro), [Token Plan FAQ](https://platform.minimax.io/docs/token-plan/faq) | **Token Plan** |
| M3 also accepts images through the Anthropic-compatible endpoint (`/anthropic`) | [Anthropic SDK](https://platform.minimax.io/docs/api-reference/text-anthropic-api) | general API |
| No documented JSON/structured-output mode found | — | adapter asks for JSON in the prompt and validates it |

## Open questions before enabling real calls

1. **Entitlement:** the Token Plan covers MiniMax-M3, and M3 accepts images, but no excerpt states explicitly that a Token Plan (`sk-cp-`) key may send `image_url` input to M3 on `/v1/chat/completions` (image understanding is also described via the separate VLM API / `understand_image` tool). General M3 capability ≠ this plan's entitlement; one real call settles it.
2. **Terms:** may a Token Plan key serve requests from a deployed app's users, or is it limited to the subscriber's own tools? Check the Token Plan terms before using it in production.
3. **Limits:** whether the 5-hour/weekly windows suit a beta (each label read is one image request).
4. **Region:** international (`api.minimax.io`) vs mainland (`api.minimaxi.com`) host for this account; set `MINIMAX_BASE_URL` if needed.

## Entering the key safely

Never paste the key into chat, an issue or a commit. The app reads `MINIMAX_API_KEY` (server only), `MINIMAX_MODEL` (default `MiniMax-M3`), `MINIMAX_BASE_URL` (default `https://api.minimax.io/v1`); `NEXT_PUBLIC_KEEPLY_SCAN=1` shows the scan screen.

### Claude cloud session (verification only)

Per [cloud environments](https://code.claude.com/docs/en/cloud-environments) (Pro/Max): add an **API credential** in the environment's settings (cloud environment menu in the session title bar → Edit → API credentials), restricted to host **`api.minimax.io`**, header **`Authorization`**, scheme **`Bearer`**. You enter the key yourself.

- The egress proxy injects it into requests to that host. It never appears as an environment variable or file, so neither commands nor Claude can read it.
- Matching credential hosts are reachable even outside the network allowlist, so no network change is needed for `api.minimax.io`.
- It applies in a new session (or when the VM is restored/rebuilt).
- **The app gate is unchanged:** `minimaxConfig` requires `MINIMAX_API_KEY`, so the app in a cloud session stays in Manual mode. Verification uses `pnpm verify:minimax` (`src/ai/minimax.live.test.ts`), which calls the adapter directly, strips its placeholder `Authorization` header and lets the proxy add the real one. It is excluded from `pnpm test` and CI.
- Do not use a plain environment variable for the key in the cloud: those are readable by commands and by Claude.

### Local (Mac)

In the root of your local clone (the folder with `package.json`, branch `claude/dazzling-mayer-ytyahw`), put `MINIMAX_API_KEY=…` in `.env.local` (gitignored by `.env.*`). Next.js uses it on the server only. Either run `pnpm verify:minimax` (the test then sends the local key itself) or run the app flow below.

### Vercel

Not yet: enabling real AI for beta users is a separate decision.

## Minimal steps to verify for real

On a machine with network access to `api.minimax.io` (e.g. the Mac), from the repo:

**Entitlement check (cloud or local):** `pnpm verify:minimax` (optionally `KEEPLY_LABEL_PHOTO=path/to/label.jpg`). Pass: it prints a parsed identity (any image works for the entitlement question; a real label tests accuracy). A MiniMax error about image input or model access answers question 1. In a cloud session without the API credential, the proxy itself returns 403.

**App flow (local only):** with `.env.local` holding `MINIMAX_API_KEY` and `NEXT_PUBLIC_KEEPLY_SCAN=1`:

```bash
pnpm build && pnpm start -p 3000 &
scripts/verify-identify.sh path/to/label.jpg   # prints the proposal from /api/identify
```

Then the phone flow: Scan → photo → Confirm / Edit / Rescan. Server errors are logged as `[identify] minimax failed: …`.
