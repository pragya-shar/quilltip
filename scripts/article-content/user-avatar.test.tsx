// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UserAvatar } from '../../components/ui/user-avatar'
import { shownAvatar } from '../../lib/tiptap/articleImage'

const OWN = 'https://own-deployment-123.convex.cloud'
const own = `${OWN}/api/storage/5c1e2f0a-photo`
const unsplash = 'https://images.unsplash.com/photo-1?w=200'
const otherConvex = 'https://someone-else-456.convex.cloud/api/storage/photo'

// Radix preloads the photo with `new window.Image()`: record every address
// it asks for, and answer at once as a loaded 64 px image.
const requested: string[] = []
class RecordingImage extends EventTarget {
  complete = false
  naturalWidth = 0
  crossOrigin: string | null = null
  referrerPolicy = ''
  set src(value: string) {
    requested.push(value)
    this.complete = true
    this.naturalWidth = 64
  }
}

beforeEach(() => {
  requested.length = 0
  vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', OWN)
  vi.stubGlobal('Image', RecordingImage)
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function render(src: string | null) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() =>
    root.render(
      createElement(UserAvatar, {
        src,
        alt: 'Ada Writer',
        name: 'Ada Writer',
        className: 'size-10',
      })
    )
  )
  const seen = {
    images: [...host.querySelectorAll('img')].map((img) =>
      img.getAttribute('src')
    ),
    rootClass: host.firstElementChild?.getAttribute('class') ?? '',
    label: host.firstElementChild?.getAttribute('aria-label'),
    text: host.textContent,
  }
  act(() => root.unmount())
  host.remove()
  return seen
}

describe('profile photos (#633)', () => {
  it('a photo from another host counts as none', () => {
    expect(shownAvatar(own)).toBe(own)
    expect(shownAvatar(` ${own} `)).toBe(own)
    expect(shownAvatar(otherConvex)).toBeUndefined()
    expect(shownAvatar(`${OWN}/api/query`)).toBeUndefined()
    expect(shownAvatar('')).toBeUndefined()
    expect(shownAvatar(null)).toBeUndefined()
  })

  it.each([own, unsplash])('shows an allowed photo: %s', (src) => {
    const seen = render(src)
    expect(seen.images).toEqual([src])
    expect(requested).toEqual([src])
  })

  it.each([
    otherConvex,
    'https://tracker.example/pixel.png',
    `${OWN}/api/query`,
  ])(
    'shows the initials for a photo from another host, with no request: %s',
    (src) => {
      const seen = render(src)
      expect(seen.images).toEqual([])
      expect(requested).toEqual([])
      expect(seen.text).toBe('A')
    }
  )

  it('keeps the same box, size and name with or without the photo', () => {
    const shown = render(own)
    const refused = render(otherConvex)
    const none = render(null)
    expect(refused.rootClass).toBe(shown.rootClass)
    expect(none.rootClass).toBe(shown.rootClass)
    expect(shown.rootClass).toContain('size-10')
    expect([shown.label, refused.label, none.label]).toEqual([
      'Ada Writer',
      'Ada Writer',
      'Ada Writer',
    ])
  })

  it('the profile page share image and the photo dialog use the same check', () => {
    const read = (path: string) =>
      readFileSync(join(__dirname, '../..', path), 'utf8')
    expect(read('app/[username]/page.tsx')).toContain(
      'const avatar = shownAvatar(profile.avatar)'
    )
    const editor = read('components/profile/ProfileAvatarEditor.tsx')
    expect(editor).toContain('if (!shownAvatar(avatarUrl)) {')
    expect(editor).toContain('toast.error(avatarSourceRefusal(avatarUrl))')
  })
})
