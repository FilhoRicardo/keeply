import { isIP } from 'node:net'

function blockedV4(p: number[]): boolean {
  const [a, b] = p
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && p[2] === 0) ||
    (a === 198 && (b === 18 || b === 19))
  )
}

function expandV6(ip: string): number[] | null {
  let s = ip.split('%')[0]
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) {
    const o = v4[1].split('.').map(Number)
    s = s.slice(0, -v4[1].length) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16)
  }
  const [head, tail] = s.split('::')
  const h = head ? head.split(':') : []
  const t = tail === undefined ? [] : tail ? tail.split(':') : []
  const fill = tail === undefined ? 0 : 8 - h.length - t.length
  const groups = [...h, ...Array(Math.max(fill, 0)).fill('0'), ...t].map((g) => parseInt(g, 16))
  return groups.length === 8 && groups.every((g) => Number.isFinite(g)) ? groups : null
}

// True for anything that is not a public unicast address (fail closed on garbage).
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) return blockedV4(ip.split('.').map(Number))
  if (kind !== 6) return true
  const g = expandV6(ip)
  if (!g) return true
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    // ::, ::1, ::ffff:a.b.c.d (IPv4-mapped) and IPv4-compatible forms
    if (g[5] === 0 && g[6] === 0 && g[7] <= 1) return true
    return blockedV4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255])
  }
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00
}
