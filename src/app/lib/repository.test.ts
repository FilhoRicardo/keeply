// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createPlanRepository } from './repository'

describe('createPlanRepository', () => {
  it('uses device storage when Supabase is not configured', () => {
    expect(createPlanRepository({}).kind).toBe('device')
  })

  it('uses Supabase when the URL and anon key are set', () => {
    expect(createPlanRepository({ url: 'https://example.supabase.co', anonKey: 'anon' }).kind).toBe('supabase')
  })
})
