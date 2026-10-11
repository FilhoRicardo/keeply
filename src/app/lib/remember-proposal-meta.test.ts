import { describe, expect, it } from 'vitest'
import { record } from '@/domain/test-fixtures'
import type { ProposalMeta } from '@/domain/model'
import { rememberProposalMeta } from './supabase-plan-repository'

const unread: ProposalMeta = {
  fallback: 'general',
  searchOutcome: 'extraction_unavailable',
  searchReason: null,
  searched: true,
}

describe('rememberProposalMeta', () => {
  it('puts a dropped extraction failure back on the plan the owner just saved', () => {
    const state = { version: 2 as const, records: [record({ proposalMeta: null })] }
    const next = rememberProposalMeta(state, new Map([['app-1', unread]]))
    expect(next.records[0].proposalMeta).toEqual(unread)
  })

  it('leaves a stored outcome alone and ignores appliances from another session', () => {
    const stored: ProposalMeta = { fallback: 'general', searchOutcome: 'no_results', searchReason: null, searched: true }
    const state = { version: 2 as const, records: [record({ proposalMeta: stored })] }
    const next = rememberProposalMeta(state, new Map([['other', unread]]))
    expect(next.records[0].proposalMeta).toEqual(stored)
    expect(next).toBe(state)
  })
})
