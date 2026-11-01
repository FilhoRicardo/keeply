// @vitest-environment jsdom
import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { noRecognizer, type ApplianceRecognizer } from '@/domain/identification'
import type { AccountService } from '../../lib/account'
import { scanEnabled } from '../../lib/features'
import type { PlanRepository } from '../../lib/plan-repository'
import { findRecord } from '../../lib/plan-state'
import { renderWithPlan, testRepository } from '../../test-utils'
import { ScanFlow } from './scan-flow'

// jsdom cannot decode images, so stand in for the browser's re-encode (which drops EXIF/GPS).
let reencode = true
vi.mock('../../lib/photo', () => ({
  prepareLabelPhoto: async (file: Blob) => (reencode ? new Blob([file], { type: 'image/jpeg' }) : file),
}))

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams() }))

let repo: PlanRepository
beforeEach(() => {
  repo = testRepository()
  push.mockReset()
  reencode = true
})

const photo = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'label.jpg', { type: 'image/jpeg' })

function googleAccount(): AccountService {
  return {
    current: async () => ({ kind: 'google', email: 'owner@example.com', name: 'Owner' }),
    onChange: () => () => {},
    signInWithGoogle: async () => ({ ok: true }),
    switchToGoogleAccount: async () => ({ ok: true }),
    signOut: async () => {},
  }
}

async function takePhoto() {
  const input = screen.getByLabelText('Take or choose a photo')
  await act(async () => fireEvent.change(input, { target: { files: [photo] } }))
}

describe('ScanFlow without recognition (v0.1)', () => {
  it('guides the photo, says nothing was read, and saves the typed identity', async () => {
    renderWithPlan(<ScanFlow recognizer={noRecognizer} />, repo)
    expect(screen.getByRole('region', { name: /photograph the label/i })).toBeInTheDocument()
    await takePhoto()

    expect(screen.getByText(/could not read an appliance label in this photo/)).toBeInTheDocument()
    expect(screen.getByLabelText('Appliance', { exact: false })).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/appliance/i)

    fireEvent.change(screen.getByLabelText('Appliance', { exact: false }), { target: { value: 'Dishwasher' } })

    fireEvent.change(screen.getByLabelText('Manufacturer'), { target: { value: 'Bosch' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Model number/), { target: { value: 'SMS6ZCI49E' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm' })))

    expect(push).toHaveBeenCalledWith('/appliances/app-1/plan')
    const appliance = findRecord(await repo.load(), 'app-1')!.appliance
    expect(appliance).toMatchObject({ manufacturer: 'Bosch', model: 'SMS6ZCI49E', identificationConfidence: null })
  })
})

describe('ScanFlow with a recogniser', () => {
  const recognizer: ApplianceRecognizer = {
    recognise: async () => ({
      notice: null,
      identification: {
      category: 'dishwasher',
      manufacturer: 'Bosch',
      model: 'SMS6ZCI49E',
      serialNumber: '',
      confidence: 0.82,
      source: 'photo_recognition',
      },
    }),
  }

  it('asks "Is this correct?" and keeps the confidence when confirmed unchanged', async () => {
    renderWithPlan(<ScanFlow recognizer={recognizer} />, repo)
    await takePhoto()
    expect(screen.getByText(/is this correct\?/)).toBeInTheDocument()
    expect(screen.getByText(/look-alikes such as V and Y/)).toBeInTheDocument()
    expect(screen.getByText('SMS6ZCI49E')).toBeInTheDocument()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm' })))
    expect(findRecord(await repo.load(), 'app-1')!.appliance.identificationConfidence).toBe(0.82)
  })

  it('drops the confidence once the owner edits', async () => {
    renderWithPlan(<ScanFlow recognizer={recognizer} />, repo)
    await takePhoto()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText(/Model number/), { target: { value: 'SMS6ZCI49F' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm' })))
    expect(findRecord(await repo.load(), 'app-1')!.appliance).toMatchObject({ model: 'SMS6ZCI49F', identificationConfidence: null })
  })

  it('shows a read serial number before the owner confirms it', async () => {
    const withSerial: ApplianceRecognizer = {
      recognise: async (blob) => {
        const result = await recognizer.recognise(blob)
        return { ...result, identification: { ...result.identification!, serialNumber: 'FD9901' } }
      },
    }
    renderWithPlan(<ScanFlow recognizer={withSerial} />, repo)
    await takePhoto()
    expect(screen.getByText('Serial number')).toBeInTheDocument()
    expect(screen.getByText('FD9901')).toBeInTheDocument()
    expect(await repo.load()).toMatchObject({ records: [] })
  })

  it('goes back to the camera on Rescan', async () => {
    renderWithPlan(<ScanFlow recognizer={recognizer} />, repo)
    await takePhoto()
    fireEvent.click(screen.getByRole('button', { name: 'Rescan' }))
    expect(screen.getByLabelText('Take or choose a photo')).toBeInTheDocument()
  })
})

describe('scanEnabled', () => {
  it('is off unless the flag is set', () => {
    expect(scanEnabled(undefined)).toBe(false)
    expect(scanEnabled('0')).toBe(false)
    expect(scanEnabled('1')).toBe(true)
  })
})

describe('ScanFlow when the type was not read', () => {
  it('asks the owner to name the appliance and keeps the other details', async () => {
    const unreadType: ApplianceRecognizer = {
      recognise: async () => ({
        notice: null,
        identification: {
          category: 'unknown',
          manufacturer: 'Electrolux',
          model: 'ABC123',
          serialNumber: 'SN1',
          confidence: 0.9,
          source: 'photo_recognition',
        },
      }),
    }
    renderWithPlan(<ScanFlow recognizer={unreadType} />, repo)
    await takePhoto()

    expect(screen.getByText(/could not tell the appliance type from this photo/i)).toBeInTheDocument()
    expect(screen.queryByText(/is this correct\?/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Appliance', { exact: false })).toHaveValue('')
    expect(screen.getByLabelText('Manufacturer')).toHaveValue('Electrolux')
    expect(screen.getByLabelText(/Model number/)).toHaveValue('ABC123')

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/appliance/i)

    fireEvent.change(screen.getByLabelText('Appliance', { exact: false }), { target: { value: 'Dishwasher' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm' })))
    expect(push).toHaveBeenCalledWith('/appliances/app-1/plan')
    expect(findRecord(await repo.load(), 'app-1')!.appliance).toMatchObject({
      manufacturer: 'Electrolux',
      model: 'ABC123',
      identificationConfidence: null,
    })
  })
})

describe('ScanFlow when the photo is not a dishwasher label', () => {
  it('shows the appliance type the model read, never claims it is "not a dishwasher"', async () => {
    // KEE-60: every recognised appliance is a valid proposal. A fridge is a valid appliance —
    // the confirm screen shows "Fridge" as the appliance, not a rejection.
    const fridge: ApplianceRecognizer = {
      recognise: async () => ({
        identification: { category: 'fridge', manufacturer: 'LG', model: 'LRFXS2503S', serialNumber: '', confidence: 0.7, source: 'photo_recognition' },
        notice: null,
      }),
    }
    renderWithPlan(<ScanFlow recognizer={fridge} />, repo)
    await takePhoto()
    expect(screen.getByText(/is this correct\?/)).toBeInTheDocument()
    expect(screen.getByText('Fridge')).toBeInTheDocument()
    expect(screen.getByText('LG')).toBeInTheDocument()
    expect(screen.getByText('LRFXS2503S')).toBeInTheDocument()
  })
})

describe('ScanFlow privacy', () => {
  it('never sends a photo it could not re-encode to the AI service', async () => {
    reencode = false
    const recognise = vi.fn(async () => ({ identification: null, notice: null }))
    renderWithPlan(<ScanFlow recognizer={{ recognise }} />, repo)
    await takePhoto()
    expect(recognise).not.toHaveBeenCalled()
    expect(screen.getByText(/could not read an appliance label in this photo/)).toBeInTheDocument()
  })
})

describe('ScanFlow when AI label reading is unavailable', () => {
  it('shows the manual form and does not ask for a clearer photo', async () => {
    const unavailable: ApplianceRecognizer = {
      recognise: async () => ({ identification: null, notice: 'ai_unavailable' }),
    }
    renderWithPlan(<ScanFlow recognizer={unavailable} />, repo)
    await takePhoto()
    expect(screen.getByText('AI label reading is unavailable right now. Enter the details below.')).toBeInTheDocument()
    expect(screen.queryByText(/clearer photo/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Manufacturer')).toHaveValue('')
    expect(screen.getByLabelText('Appliance', { exact: false })).toHaveValue('')
  })

  it('explains when Keeply hit its AI provider limit', async () => {
    const limited: ApplianceRecognizer = {
      recognise: async () => ({ identification: null, notice: 'ai_limit' }),
    }
    renderWithPlan(<ScanFlow recognizer={limited} />, repo)
    await takePhoto()
    expect(screen.getByText('Keeply has hit its AI limit for today. Enter the details below or try again later.')).toBeInTheDocument()
    expect(screen.getByLabelText('Appliance', { exact: false })).toHaveValue('')
  })
})

describe('ScanFlow when no plan can be built', () => {
  const fridge: ApplianceRecognizer = {
    recognise: async () => ({
      identification: {
        category: 'fridge',
        manufacturer: 'Bosch',
        model: 'KGN39VLEB',
        serialNumber: '',
        confidence: 0.8,
        source: 'photo_recognition',
      },
      notice: null,
    }),
  }

  it.each([
    ['extraction_unavailable', /Keeply found manuals but could not read them right now/],
    ['timeout', /Keeply found manuals but could not read them right now/],
    ['no_results', /could not find suitable manufacturer guidance/i],
  ] as const)('a fridge with %s stays on the confirm screen and says why', async (outcome, copy) => {
    const propose = vi.fn(async () => ({
      proposals: [],
      meta: { fallback: 'general' as const, searchOutcome: outcome, searchReason: null, searched: true },
    }))
    renderWithPlan(<ScanFlow recognizer={fridge} />, repo, undefined, { proposer: propose })
    await takePhoto()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm' })))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(copy)
    expect(alert).not.toHaveTextContent(/no manufacturer manual found/i)
    expect(alert).not.toHaveTextContent(/general dishwasher tasks/i)
    expect(screen.getByText('Bosch')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })
})

describe('ScanFlow AI access copy', () => {
  it.each([
    ['no_invite', /Sign in with Google on the Home screen to use AI label reading\. The photo was not sent to the AI service/],
    ['tester_limit', /You have used today’s AI scans, so the photo was not sent/],
    ['daily_limit', /reached today’s AI scan limit, so the photo was not sent/],
  ] as const)('explains a %s refusal and offers the manual form', async (notice, copy) => {
    const events: { name: string }[] = []
    const refusing: ApplianceRecognizer = { recognise: async () => ({ identification: null, notice }) }
    renderWithPlan(<ScanFlow recognizer={refusing} />, repo, (e) => void events.push(e))
    await takePhoto()
    expect(screen.getByText(copy)).toBeInTheDocument()
    expect(screen.getByLabelText('Manufacturer')).toHaveValue('')
    expect(events.map((e) => e.name)).toEqual(['scan_started', 'scan_denied'])
  })

  it('shows how many AI scans are left, or how to sign in', async () => {
    const access = { ai: true, access: 'invited', testerLeft: 10, globalLeft: 12 }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(access)))
    renderWithPlan(<ScanFlow recognizer={noRecognizer} />, repo, undefined, { account: googleAccount() })
    expect(await screen.findByText('AI label reading: 10 scans left today.')).toBeInTheDocument()
    expect(await screen.findByText('Daily limits apply to AI scans.')).toBeInTheDocument()
    expect(screen.queryByText(/invite/i)).not.toBeInTheDocument()
    vi.unstubAllGlobals()

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ai: true, access: 'no_invite' })))
    renderWithPlan(<ScanFlow recognizer={noRecognizer} />, testRepository())
    expect(await screen.findByText(/Sign in with Google on the Home screen to use AI label reading/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Have an invite code?' })).toHaveAttribute('href', '/invite')
    expect(screen.queryByText(/invited testers/i)).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('does not upload the photo when the visitor already has no invite', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ai: true, access: 'no_invite' })))
    const recognise = vi.fn(async () => ({ identification: null, notice: null }))
    renderWithPlan(<ScanFlow recognizer={{ recognise }} />, repo)
    await screen.findByRole('link', { name: 'Have an invite code?' })
    await takePhoto()
    expect(recognise).not.toHaveBeenCalled()
    expect(screen.getByText(/The photo was not sent to the AI service/)).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})
