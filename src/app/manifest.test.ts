import { describe, expect, it } from 'vitest'
import manifest from './manifest'

describe('web app manifest', () => {
  it('makes Keeply installable with standard and maskable icons', () => {
    expect(manifest()).toMatchObject({
      name: 'Keeply',
      short_name: 'Keeply',
      start_url: '/',
      display: 'standalone',
      theme_color: '#13733f',
      background_color: '#eef1ef',
      icons: expect.arrayContaining([
        expect.objectContaining({ src: '/icons/icon-192.png', sizes: '192x192' }),
        expect.objectContaining({ src: '/icons/icon-512.png', sizes: '512x512' }),
        expect.objectContaining({
          src: '/icons/icon-maskable-192.png',
          sizes: '192x192',
          purpose: 'maskable',
        }),
        expect.objectContaining({
          src: '/icons/icon-maskable-512.png',
          sizes: '512x512',
          purpose: 'maskable',
        }),
      ]),
    })
  })
})
