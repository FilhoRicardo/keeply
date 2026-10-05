import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { AccountService } from './lib/account'
import { PlanProvider } from './lib/plan-context'
import { createDevicePlanRepository, memoryStorage, type PlanRepository } from './lib/plan-repository'
import type { PlanProposer } from './lib/propose'
import { noopSink, type EventSink } from './lib/track'
import type { ProposalMeta, TaskProposal } from '@/domain/model'
import type { NewApplianceInput } from './lib/plan-state'

// A device repository on in-memory storage with readable ids: app-1, then task-1, task-2, …
export function testRepository(): PlanRepository {
  let apps = 0
  let tasks = 0
  let next: 'app' | 'task' = 'app'
  const repo = createDevicePlanRepository({
    storage: memoryStorage(),
    newId: () => {
      const id = next === 'app' ? `app-${++apps}` : `task-${++tasks}`
      next = 'task'
      return id
    },
    now: () => '2026-10-04T10:00:00Z',
  })
  return {
    ...repo,
    addAppliance: (input: NewApplianceInput, proposals: readonly TaskProposal[], meta?: ProposalMeta | null) =>
      ((next = 'app'), repo.addAppliance(input, proposals, meta)),
  }
}

export function renderWithPlan(
  ui: ReactNode,
  repository: PlanRepository = testRepository(),
  sink: EventSink = noopSink,
  options: { account?: AccountService; proposer?: PlanProposer } = {},
) {
  return {
    repository,
    ...render(
      <PlanProvider repository={repository} sink={sink} account={options.account} proposer={options.proposer}>
        {ui}
      </PlanProvider>,
    ),
  }
}
