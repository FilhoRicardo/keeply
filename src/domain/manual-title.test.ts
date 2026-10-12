import { describe, expect, it } from 'vitest'
import { manualSourceTitle } from './manual-title'

const electrolux = { manufacturer: 'Electrolux', model: 'KEQB7300L' }

describe('manualSourceTitle', () => {
  it('keeps a readable document title', () => {
    expect(
      manualSourceTitle({
        documentTitle: 'Electrolux KEQB7300L user manual',
        ...electrolux,
      }),
    ).toBe('Electrolux KEQB7300L user manual')
  })

  it('replaces a UUID or a pdf file name with the appliance manual name', () => {
    const fallback = 'Electrolux KEQB7300L user manual'
    expect(
      manualSourceTitle({
        documentTitle: '550e8400-e29b-41d4-a716-446655440000',
        ...electrolux,
      }),
    ).toBe(fallback)
    expect(
      manualSourceTitle({
        documentTitle: '550e8400-e29b-41d4-a716-446655440000.pdf',
        ...electrolux,
      }),
    ).toBe(fallback)
    expect(manualSourceTitle({ documentTitle: 'KEQB7300L.pdf', ...electrolux })).toBe(fallback)
  })

  it('replaces a host label with the appliance manual name', () => {
    const fallback = 'Electrolux KEQB7300L user manual'
    expect(manualSourceTitle({ documentTitle: 'Electrolux-medialibrary', ...electrolux })).toBe(fallback)
    expect(manualSourceTitle({ documentTitle: 'api.electrolux-medialibrary.com', ...electrolux })).toBe(fallback)
    expect(manualSourceTitle({ documentTitle: 'cdn', ...electrolux })).toBe(fallback)
    expect(manualSourceTitle({ documentTitle: 'api', ...electrolux })).toBe(fallback)
  })

  it('replaces a placeholder or export name from the PDF metadata', () => {
    const fallback = 'Electrolux KEQB7300L user manual'
    // Live: the Electrolux KEQB7300L manual's PDF metadata title is "Title".
    for (const placeholder of ['Title', 'Untitled', 'Manual', 'User manual', 'KEQB7300L', 'Microsoft Word - IM_KEQB7300L.docx']) {
      expect(manualSourceTitle({ documentTitle: placeholder, ...electrolux })).toBe(fallback)
    }
    expect(manualSourceTitle({ documentTitle: 'Dishwasher user manual KEQB7300L', ...electrolux })).toBe('Dishwasher user manual KEQB7300L')
  })

  it('names a similar-model source with the covered model', () => {
    expect(
      manualSourceTitle({
        documentTitle: 'Electrolux-medialibrary',
        manufacturer: 'Electrolux',
        model: 'KEQC7200L',
      }),
    ).toBe('Electrolux KEQC7200L user manual')
  })
})
