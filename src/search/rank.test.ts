import { describe, expect, it } from 'vitest'
import { rankCandidates, type RawCandidate } from './rank'

const manufacturerDomains = {
  bosch: ['bosch-home.com', 'bosch.com'],
  miele: ['miele.com'],
}

function raw(url: string, title = 'manual', snippet = ''): RawCandidate {
  return { url, title, snippet, host: new URL(url).host }
}

describe('rankCandidates', () => {
  it('drops non-https results', () => {
    const candidates = [raw('http://bosch-home.com/manual.pdf'), raw('https://bosch-home.com/manual.pdf')]
    const out = rankCandidates(candidates, { manufacturer: 'bosch', model: 'SMS6', manufacturerDomains })
    expect(out.map((c) => c.url)).toEqual(['https://bosch-home.com/manual.pdf'])
  })

  it('rejects hyphenated look-alike manufacturer domains', () => {
    const candidates = [
      raw('https://bosch-home.com/SMS6-manual.pdf'),
      raw('https://bosch-support.example.com/SMS6.pdf'),
      raw('https://bosch-repairs.example.net/SMS6.pdf'),
      raw('https://example.com/bosch-clone/page'),
    ]
    const out = rankCandidates(candidates, { manufacturer: 'bosch', model: 'SMS6', manufacturerDomains })
    // None of the false-positive hosts should be marked as the manufacturer — only the
    // trusted registrable domains earn the +100 boost.
    for (const c of out) {
      if (c.url.includes('bosch-support.example.com')) expect(c.manufacturerMatch).toBe(false)
      if (c.url.includes('bosch-repairs.example.net')) expect(c.manufacturerMatch).toBe(false)
      if (c.url.includes('bosch-clone')) expect(c.manufacturerMatch).toBe(false)
    }
    // The legitimate host outranks every look-alike because of the manufacturer boost.
    expect(out[0]?.url).toBe('https://bosch-home.com/SMS6-manual.pdf')
    expect(out[0]?.manufacturerMatch).toBe(true)
  })

  it('accepts subdomains of trusted manufacturer hosts', () => {
    const candidates = [raw('https://support.bosch-home.com/SMS6-manual.pdf'), raw('https://files.bosch.com/x.pdf')]
    const out = rankCandidates(candidates, { manufacturer: 'bosch', model: 'SMS6', manufacturerDomains })
    expect(out).toHaveLength(2)
    expect(out.every((c) => c.manufacturerMatch)).toBe(true)
  })

  it('rejects manufacturer tokens that appear only in the path, not the host', () => {
    const candidates = [raw('https://random-blog.example.com/bosch/SMS6-manual.pdf')]
    const out = rankCandidates(candidates, { manufacturer: 'bosch', model: 'SMS6', manufacturerDomains })
    expect(out[0]?.manufacturerMatch).toBe(false)
  })

  it('drops resellers and forum hosts', () => {
    const candidates = [
      raw('https://amazon.com/dp/B123'),
      raw('https://reddit.com/r/dishwashers/comments/1'),
      raw('https://facebook.com/groups/dishwashers'),
      raw('https://bosch-home.com/manual.pdf'),
      raw('https://twitter.com/somebody/status/1'),
    ]
    const out = rankCandidates(candidates, { manufacturer: 'bosch', model: 'SMS6', manufacturerDomains })
    expect(out.map((c) => c.url)).toEqual(['https://bosch-home.com/manual.pdf'])
  })

  it('boosts PDF and manual-looking URLs and model matches', () => {
    const candidates = [
      raw('https://docs.example.com/page', 'Some page', 'general'),
      raw('https://docs.example.com/SMS6.pdf', 'SMS6 user manual'),
      raw('https://docs.example.com/SMS6-handbuch.pdf', 'SMS6 Handbuch'),
    ]
    const out = rankCandidates(candidates, { manufacturer: 'miele', model: 'SMS6', manufacturerDomains })
    // PDFs and manual-looking outrank a plain page; ties (PDF + manual + model match)
    // are broken deterministically by URL.
    expect(out[0]?.url).toBe('https://docs.example.com/SMS6-handbuch.pdf')
    expect(out[1]?.url).toBe('https://docs.example.com/SMS6.pdf')
    expect(out[2]?.url).toBe('https://docs.example.com/page')
    // The plain page should rank last, with the lowest score.
    expect(out[0]?.score).toBeGreaterThanOrEqual(out[1]?.score ?? 0)
    expect(out[1]?.score).toBeGreaterThan(out[2]?.score ?? 0)
    expect(out[2]?.score).toBe(0)
  })

  it('dedupes URLs that appear across multiple queries', () => {
    const a = raw('https://bosch-home.com/SMS6-manual.pdf', 'user manual', 'snippet A')
    const b = raw('https://bosch-home.com/SMS6-manual.pdf', 'instruction manual', 'snippet B')
    const out = rankCandidates([a, b], { manufacturer: 'bosch', model: 'SMS6', manufacturerDomains })
    expect(out).toHaveLength(1)
  })

  it('caps results to a deterministic max and orders ties by URL', () => {
    const urls = [
      'https://docs.example.com/page-2',
      'https://docs.example.com/page-1',
      'https://docs.example.com/page-4',
      'https://docs.example.com/page-3',
      'https://docs.example.com/page-5',
      'https://docs.example.com/page-6',
      'https://docs.example.com/page-7',
    ]
    const out = rankCandidates(urls.map((u) => raw(u)), { manufacturer: 'miele', model: 'M1', manufacturerDomains, cap: 5 })
    expect(out).toHaveLength(5)
    // The cap is the first five URLs in lexicographic order (all tied on score).
    expect(out.map((c) => c.url)).toEqual(urls.slice().sort().slice(0, 5))
  })

  it('returns an empty list for an empty input', () => {
    expect(rankCandidates([], { manufacturer: 'miele', model: 'M1', manufacturerDomains })).toEqual([])
  })

  it('keeps the order stable for equal scores (deterministic)', () => {
    const candidates = [
      raw('https://a.example.com/manual'),
      raw('https://b.example.com/manual'),
      raw('https://c.example.com/manual'),
    ]
    const first = rankCandidates(candidates, { manufacturer: 'miele', model: 'M1', manufacturerDomains })
    const second = rankCandidates(candidates, { manufacturer: 'miele', model: 'M1', manufacturerDomains })
    expect(first.map((c) => c.url)).toEqual(second.map((c) => c.url))
  })
})
