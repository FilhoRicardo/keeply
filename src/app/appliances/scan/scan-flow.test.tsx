// @vitest-environment jsdom
import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { noRecognizer, type ApplianceRecognizer } from '@/domain/identification'
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

async function takePhoto() {
  const input = screen.getByLabelText('Take or choose a photo')
  await act(async () => fireEvent.change(input, { target: { files: [photo] } }))
}

describe('ScanFlow without recognition (v0.1)', () => {
  it('guides the photo, says nothing was read, and saves the typed identity', async () => {
    renderWithPlan(<ScanFlow recognizer={noRecognizer} />, repo)
    expect(screen.getByText(/photograph the label/i)).toBeInTheDocument()
    await takePhoto()

    expect(screen.getByText(/could not read a dishwasher label in this photo/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/manufacturer/)

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

describe('ScanFlow when the photo is not a dishwasher label', () => {
  it('stays neutral and leaves the owner to rescan or type', async () => {
    const notDishwasher: ApplianceRecognizer = { recognise: async () => ({ identification: null, notice: 'not_a_dishwasher' }) }
    renderWithPlan(<ScanFlow recognizer={notDishwasher} />, repo)
    await takePhoto()
    // A whole-appliance photo can come back as "other"; never claim it is not a dishwasher.
    expect(screen.getByText(/could not read a dishwasher label in this photo/)).toBeInTheDocument()
    expect(screen.queryByText(/does not look like a dishwasher/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Manufacturer')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Rescan' })).toBeInTheDocument()
  })
})

describe('ScanFlow privacy', () => {
  it('never sends a photo it could not re-encode to the AI service', async () => {
    reencode = false
    const recognise = vi.fn(async () => ({ identification: null, notice: null }))
    renderWithPlan(<ScanFlow recognizer={{ recognise }} />, repo)
    await takePhoto()
    expect(recognise).not.toHaveBeenCalled()
    expect(screen.getByText(/could not read a dishwasher label in this photo/)).toBeInTheDocument()
  })
})
