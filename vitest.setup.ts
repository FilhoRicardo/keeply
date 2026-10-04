import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest globals are off, so Testing Library cannot register its own cleanup.
afterEach(cleanup)

// Plan state loads asynchronously; jsdom on a busy CI runner can exceed the 1 s default.
configure({ asyncUtilTimeout: 3000 })
