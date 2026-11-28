import { describe, expect, it } from 'vitest'
import { avatarSrc, type AvatarSources } from '@/system/media/avatarSource'

const sources: AvatarSources = {
  storageOrigin: 'https://quiet-otter-123.convex.cloud',
  storagePath: '/api/storage/',
}

describe('where an avatar may come from', () => {
  it("takes this deployment's storage and same-site paths", () => {
    expect(
      avatarSrc(
        'https://quiet-otter-123.convex.cloud/api/storage/0b1c-2d3e',
        sources
      )
    ).toBe('https://quiet-otter-123.convex.cloud/api/storage/0b1c-2d3e')
    expect(avatarSrc('/prototype/avatars/tomas.png', sources)).toBe(
      '/prototype/avatars/tomas.png'
    )
  })

  it('refuses every other address, so initials show', () => {
    for (const value of [
      'https://evil.example/pixel.png',
      // Another deployment on the same platform: anyone can create one.
      'https://someone-else-9.convex.cloud/api/storage/0b1c',
      'https://quiet-otter-123.convex.cloud/other/path.png',
      'https://user:pass@quiet-otter-123.convex.cloud/api/storage/x',
      'http://quiet-otter-123.convex.cloud/api/storage/x',
      '//evil.example/x.png',
      '/\\evil.example/x.png',
      'data:image/png;base64,AAAA',
      'blob:https://quilltip.example/1',
      'javascript:alert(1)',
      ' ',
      '',
      null,
      undefined,
    ])
      expect(avatarSrc(value, sources), String(value)).toBeNull()
  })

  it('takes no storage address when the deployment is not known', () => {
    expect(
      avatarSrc('https://quiet-otter-123.convex.cloud/api/storage/x', {
        storageOrigin: null,
        storagePath: '/api/storage/',
      })
    ).toBeNull()
  })
})
