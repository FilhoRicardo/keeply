#!/usr/bin/env node
// VERIFICATION ONLY, for a Claude cloud session whose environment holds a MiniMax API credential
// (injected by the egress proxy; never visible here). Lets a locally running Keeply server reach
// MiniMax without a real key: start the server with MINIMAX_BASE_URL=http://127.0.0.1:<port>/v1 and
// a placeholder MINIMAX_API_KEY. This relay drops that placeholder Authorization header and
// forwards only POST /v1/chat/completions to api.minimax.io through the proxy, which adds the real
// one. Listens on 127.0.0.1 only. Never use it in production.
//
//   NODE_USE_ENV_PROXY=1 node scripts/minimax-proxy-relay.mjs [port] [reply-log.jsonl]
//
// The optional log records each reply's status and model message content (no headers).
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 8787)
const replyLog = process.argv[3]
const upstream = 'https://api.minimax.io/v1/chat/completions'

createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404).end()
    return
  }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  try {
    const response = await fetch(upstream, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.concat(chunks),
      signal: AbortSignal.timeout(30_000),
    })
    const text = await response.text()
    let content = null
    try {
      content = JSON.parse(text).choices?.[0]?.message?.content ?? null
    } catch {}
    console.log(`[relay] MiniMax HTTP ${response.status}`)
    if (replyLog) appendFileSync(replyLog, JSON.stringify({ at: new Date().toISOString(), status: response.status, content, error: response.ok ? null : text.slice(0, 200) }) + '\n')
    res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') ?? 'application/json' }).end(text)
  } catch (error) {
    console.log(`[relay] upstream failed: ${error instanceof Error ? error.message : error}`)
    res.writeHead(502).end()
  }
}).listen(port, '127.0.0.1', () => console.log(`[relay] 127.0.0.1:${port} → ${upstream}`))
