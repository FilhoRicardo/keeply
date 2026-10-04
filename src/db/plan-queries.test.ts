import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { deleteAppliance } from './plan-queries'

// Minimal fake of the two supabase-js calls deleteAppliance makes.
function fakeDb(row: { id: string; image_url: string | null } | null, removeError: { message: string } | null = null) {
  const remove = vi.fn().mockResolvedValue({ data: [], error: removeError })
  const db = {
    from: () => ({ delete: () => ({ eq: () => ({ select: async () => ({ data: row ? [row] : [], error: null }) }) }) }),
    storage: { from: vi.fn(() => ({ remove })) },
  }
  return { db: db as unknown as SupabaseClient, remove, storage: db.storage }
}

describe('deleteAppliance', () => {
  it('removes the label photo from storage after the row', async () => {
    const { db, remove, storage } = fakeDb({ id: 'a', image_url: 'user/a.jpg' })
    await deleteAppliance(db, 'a')
    expect(storage.from).toHaveBeenCalledWith('appliance-photos')
    expect(remove).toHaveBeenCalledWith(['user/a.jpg'])
  })

  it('does not touch storage when there is no photo', async () => {
    const { db, remove } = fakeDb({ id: 'a', image_url: null })
    await deleteAppliance(db, 'a')
    expect(remove).not.toHaveBeenCalled()
  })

  it('reports a photo that could not be removed', async () => {
    const { db } = fakeDb({ id: 'a', image_url: 'user/a.jpg' }, { message: 'denied' })
    await expect(deleteAppliance(db, 'a')).rejects.toThrow(/photo could not be removed: denied/)
  })

  it('reports an unknown or foreign appliance', async () => {
    const { db } = fakeDb(null)
    await expect(deleteAppliance(db, 'a')).rejects.toThrow(/Unknown appliance/)
  })
})
