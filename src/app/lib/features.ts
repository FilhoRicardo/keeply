// Phase 2 scanning is groundwork behind a flag until the team turns it on.
export function scanEnabled(env: string | undefined = process.env.NEXT_PUBLIC_KEEPLY_SCAN): boolean {
  return env === '1' || env === 'true'
}
