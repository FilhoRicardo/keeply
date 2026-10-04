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
| No documented JSON/structured-output mode found | — | adapter asks for JSON in the prompt and validates it |

## Open questions before enabling real calls

1. **Entitlement:** does a Token Plan key accept `image_url` input to MiniMax-M3 on `/v1/chat/completions`, or is image understanding on Token Plan only via the separate VLM API / `understand_image` MCP tool? (General M3 capability ≠ this plan's entitlement.)
2. **Terms:** may a Token Plan key serve requests from a deployed app's users, or is it limited to the subscriber's own tools? Check the Token Plan terms before using it in production.
3. **Limits:** whether the 5-hour/weekly windows suit a beta (each label read is one image request).
4. **Region:** international (`api.minimax.io`) vs mainland (`api.minimaxi.com`) host for this account; set `MINIMAX_BASE_URL` if needed.

## Minimal steps to verify for real

On a machine with network access to `api.minimax.io` (e.g. the Mac), from the repo:

```bash
# 1. Key in the environment, never in the repo or chat
export MINIMAX_API_KEY=…      # sk-cp-… from Billing → Token Plan
export MINIMAX_MODEL=MiniMax-M3
export NEXT_PUBLIC_KEEPLY_SCAN=1

# 2. Build and start
pnpm build && pnpm start -p 3000 &

# 3. Send a real dishwasher label photo
scripts/verify-identify.sh path/to/label.jpg
```

Pass: a JSON `identification` with the label's manufacturer/model. A 401/403 or a MiniMax error about image input answers question 1 (logged by the server as `[identify] minimax failed: …`). Then try the phone flow: Scan → photo → Confirm / Edit / Rescan.

To use it from this cloud session instead: add `MINIMAX_API_KEY` as an environment variable in the cloud environment settings and allow `api.minimax.io` (and `platform.minimax.io` for docs) in its network access, then start a new session.
