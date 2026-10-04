import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { PlanProvider } from './lib/plan-context'
import { createDevicePlanRepository, memoryStorage, type PlanRepository } from './lib/plan-repository'
import { noopSink, type EventSink } from './lib/track'

// A device repository on in-memory storage with readable ids: app-1, task-1, task-2, …
export function testRepository(): PlanRepository {
  let apps = 0
  let tasks = 0
  let next: 'app' | 'task' = 'app'
  const repo = createDevicePlanRepository({
    storage: memoryStorage(),
    newId: () => (next === 'app' ? `app-${++apps}` : `task-${++tasks}`),
    now: () => '2026-10-04T10:00:00Z',
  })
  return {
    ...repo,
    addAppliance: (input) => ((next = 'app'), repo.addAppliance(input)),
    approve: (a, start) => ((next = 'task'), repo.approve(a, start)),
  }
}

export function renderWithPlan(ui: ReactNode, repository: PlanRepository = testRepository(), sink: EventSink = noopSink) {
  return {
    repository,
    ...render(
      <PlanProvider repository={repository} sink={sink}>
        {ui}
      </PlanProvider>,
    ),
  }
}
