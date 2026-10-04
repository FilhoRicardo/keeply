# MiniMax appliance-identification provider

Status (2026-10-04): **adapter implemented; MiniMax-M3 image input verified live with this account's Token Plan key (synthetic images only); real-label accuracy not yet tested.** `pnpm test` and CI use mocks or a local stand-in server, not MiniMax. Real calls happen only when `MINIMAX_API_KEY` is set on the server (and scanning is enabled); otherwise Keeply stays in Manual mode.

Code: `src/ai/minimax.ts` (all MiniMax request/response handling), `src/ai/identity.ts` (Keeply's neutral schema `applianceType, manufacturer, model, serialNumber, confidence`), `src/ai/provider.ts` (selection; Manual always last). Workflow: photo → `/api/identify` → provider → neutral identity → Confirm / Edit / Rescan. Nothing is saved without the owner confirming; any edit drops the AI confidence. Only photos the browser re-encoded (EXIF/GPS dropped) are sent.

## Verification log

- 2026-10-04 17:00 UTC, earlier cloud session: `pnpm verify:minimax` → HTTP 403 "Host not in allowlist: api.minimax.io". The request never reached MiniMax. Root cause (found 17:11 UTC): Node's built-in `fetch` ignores `HTTPS_PROXY`, so the test bypassed the credential-injecting proxy and the sandbox firewall answered. Fixed in the test path only: the script sets `NODE_USE_ENV_PROXY=1`, and the test now reports a firewall/proxy block separately from a MiniMax rejection.
- 2026-10-04 17:11–17:13 UTC, new cloud session with the "MiniMax Keeply verification" API credential (proxy-injected; the key was never visible to commands). Model `MiniMax-M3`, `https://api.minimax.io/v1/chat/completions`, `image_url` data URI, `thinking` disabled:
  - Default synthetic Keeply icon (`public/icons/icon-512.png`): HTTP 200, valid schema, `{"applianceType":"unknown","manufacturer":null,"model":null,"serialNumber":null,"confidence":0}`. This is correct for an image with no label, and nothing was invented.
  - Synthetic rendered label with an invented brand (NORDVIK, Type DW-4821X, S/N 7731004215K; generated in the session, not committed): `{"applianceType":"dishwasher","manufacturer":"NORDVIK","model":"DW-4821X","serialNumber":"7731004215K","confidence":0.98}`. All three fields exactly match the printed text, so the image is actually read.
  - **Answers open question 1:** this Token Plan key may send image input to MiniMax-M3 on `/v1/chat/completions`.
  - **Not established:** accuracy on real photographed labels (glare, angle, wear, small print). No real photo was supplied. Next: `KEEPLY_LABEL_PHOTO=… pnpm verify:minimax` locally with a few real labels.
- 2026-10-04 17:18–17:22 UTC, cloud session, **app flow end to end with live MiniMax** (browser upload on a Pixel 7 viewport → `/api/identify` → `src/ai/minimax.ts` → test relay → proxy → MiniMax HTTP 200 → Confirm / Edit / Rescan → saved appliance). Wiring is described under "Cloud app-flow check" below. **Every image was a SYNTHETIC fixture rendered in the session; no real photograph has been run through the app yet.**
  - Synthetic rendered label (invented NORDVIK / DW-4821X / 7731004215K): proposal `{manufacturer: "NORDVIK", model: "DW-4821X", serialNumber: "7731004215K", confidence: 0.95}`. The confirm screen showed Dishwasher / NORDVIK / DW-4821X; Edit opened prefilled fields; Rescan returned to capture; Confirm saved the appliance with the photo and the model's confidence.
  - Synthetic flat drawing of a dishwasher front (no plate, no text): MiniMax answered `other` on one call and `unknown` on the next. Manufacturer, model and serial were null both times, so nothing was invented. The app showed "does not look like a dishwasher's" or "could not read the label" respectively, with the manual form.
  - Server without `MINIMAX_API_KEY`: Manual mode, no relay call, manual form; Confirm saved the owner-typed manufacturer with confidence null.
  - Defect found and fixed: the "Enter the manufacturer" error stayed visible after the owner typed one. It now clears on any field edit (`scan-flow.tsx`, covered in `scan-flow.test.tsx`).
  - Real public photo run: see the next entry.
- 2026-10-04 17:29 UTC, cloud session, **app flow with a real photograph and live MiniMax**: [Dishwasher with dishes.JPG](https://commons.wikimedia.org/wiki/File:Dishwasher_with_dishes.JPG), Piotrus, Wikimedia Commons, CC BY-SA 3.0. It is an open dishwasher seen from above (racks, pots, plates, a mug printed "NESCAFÉ"), with no rating plate visible. The owner supplied the image bytes as a chat attachment (2000×1500 JPEG, no EXIF; probably re-encoded by the upload). It was uploaded through the browser as `photo.jpg`, so no title or metadata reached the model. Same wiring as above: two runs in fresh, disposable browser profiles, four MiniMax calls, all HTTP 200.
  - Model replies, verbatim: `other`/null/null/null/0; `dishwasher`/null/null/null/0; `dishwasher`/null/null/null/0; `dishwasher`/null/null/null/0.1 (type/manufacturer/model/serial/confidence). **Never invented a manufacturer, model or serial**: the NESCAFÉ text was not taken as a brand. Type was right in 3 of 4 calls.
  - App: no proposal in every case (by design, there was no manufacturer). For a `dishwasher` reply it showed "Keeply could not read the label…" with the manual form. For the `other` reply it showed "This label does not look like a dishwasher's…", which is **wrong wording for a photo of a dishwasher**, though the owner can still rescan or type. Empty Confirm showed the manufacturer error; Rescan returned to capture; typing a manufacturer then Confirm saved the appliance with the photo and confidence null.
  - Fixed afterwards (no new live calls): both uncertain outcomes (`other`, and unknown or nothing read) now show "Keeply could not read a dishwasher label in this photo. Try a clearer photo of the label, or enter the details below." Rescan and manual entry are unchanged.
  - Limitations: one photo, four calls; a classification wobble (`other` vs `dishwasher`) on identical input; no rating-plate photo yet, so real label-reading accuracy is still untested.
- 2026-10-04 17:35 UTC, cloud session, **real rating-plate photo (owner-supplied, not stored in the repo)**, same live wiring: browser upload → `/api/identify` → MiniMax (2 calls: initial + one rescan, both HTTP 200). Only image bytes and the standard prompt were sent.
  - Type, manufacturer and serial were read correctly on both calls. The model number was correct on call 1 (confidence 0.95). Call 2 misread one letter as a visually similar one (V read as Y) at a *higher* confidence (0.97). Model confidence therefore does not show when a character is misread; the owner's check against the plate is what catches it.
  - Nothing was saved before Confirm (device storage stayed empty through the proposal, Edit and Rescan). After an Edit, Confirm saved with `identificationConfidence: null`.
  - Defect fixed: the proposal screen did not show the serial number, although Confirm saved it. It now shows any serial that was read, so the owner sees everything they approve.
- 2026-10-04 17:41–17:43 UTC, cloud session, same owner-supplied plate (not stored in the repo), three more live calls through the app. Type, manufacturer and serial were correct every time. The model number was misread at the same character (V read as Y) on all three, confidence 0.92–0.95: **4 of 5 calls on this plate misread it**. Confirming directly saved the misread value with the AI confidence; Edit → Confirm saved the corrected value with confidence null. Both records survived a reload (device storage). An undecodable file never reached `/api/identify`, and an unreachable provider fell back to the manual form with the neutral message. Conclusion: look-alike characters need the owner's check against the plate; the confidence score does not flag them.

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

1. ~~**Entitlement**~~ **Answered 2026-10-04 (see Verification log): yes, image input to M3 works with this key.** Original question: the Token Plan covers MiniMax-M3, and M3 accepts images, but no excerpt states explicitly that a Token Plan (`sk-cp-`) key may send `image_url` input to M3 on `/v1/chat/completions` (image understanding is also described via the separate VLM API / `understand_image` tool). General M3 capability ≠ this plan's entitlement; one real call settles it.
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

### Cloud app-flow check (verification only)

Runs the real app against live MiniMax without a real key reaching the app or any command. Everything binds to 127.0.0.1; nothing is deployed.

```bash
NEXT_PUBLIC_KEEPLY_SCAN=1 pnpm build
NODE_USE_ENV_PROXY=1 node scripts/minimax-proxy-relay.mjs 8787 replies.jsonl &   # drops the placeholder key; proxy adds the real one
env -u HTTPS_PROXY -u https_proxy NEXT_PUBLIC_KEEPLY_SCAN=1 MINIMAX_API_KEY=placeholder-not-a-key \
  MINIMAX_BASE_URL=http://127.0.0.1:8787/v1 pnpm exec next start -H 127.0.0.1 -p 3200 &
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/live-scan-check.mjs http://127.0.0.1:3200 photo.jpg out/ run1
```

The app code and its `MINIMAX_API_KEY` gate are unchanged. The placeholder only satisfies the gate locally, and the relay strips it. `live-scan-check.mjs` uploads the photo under a neutral filename (`photo.jpg`), so the filename never hints at the answer. It saves screenshots, the `/api/identify` response and the saved record.

### Local (Mac)

In the root of your local clone (the folder with `package.json`, branch `claude/dazzling-mayer-ytyahw`), put `MINIMAX_API_KEY=…` in `.env.local` (gitignored by `.env.*`). Next.js uses it on the server only. Either run `pnpm verify:minimax` (the test then sends the local key itself) or run the app flow below.

### Vercel

Not yet: enabling real AI for beta users is a separate decision.

## Minimal steps to verify for real

On a machine with network access to `api.minimax.io` (e.g. the Mac), from the repo:

**Entitlement check (cloud or local):** `pnpm verify:minimax` (optionally `KEEPLY_LABEL_PHOTO=path/to/label.jpg`). Pass: it prints a parsed identity (any image works for the entitlement question; a real label tests accuracy). A MiniMax error about image input or model access answers question 1. In a cloud session, a 403 "Host not in allowlist" means the request bypassed the credential proxy or no matching credential exists. The test reports it as an egress-proxy block, not a MiniMax error.

**App flow (local only):** with `.env.local` holding `MINIMAX_API_KEY` and `NEXT_PUBLIC_KEEPLY_SCAN=1`:

```bash
pnpm build && pnpm start -p 3000 &
scripts/verify-identify.sh path/to/label.jpg   # prints the proposal from /api/identify
```

Then the phone flow: Scan → photo → Confirm / Edit / Rescan. Server errors are logged as `[identify] minimax failed: …`.
