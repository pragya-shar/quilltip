// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  prepareReadingFaces,
  resetReadingFaces,
  upgradeAtPageChange,
} from '@/system/readingFaceUpgrade'

const pairs = {
  latin: { first: "'Roman'", next: "'Roman Next'", italic: false },
  latinItalic: { first: "'Italic'", next: "'Italic Next'", italic: true },
  extended: { first: "'Ext'", next: "'Ext Next'", italic: false },
  extendedItalic: {
    first: "'ExtItalic'",
    next: "'ExtItalic Next'",
    italic: true,
  },
}
const lists = {
  '--qt-face-read': ['latin', 'extended', 'Read Fallback'],
  '--qt-face-read-italic': ['latinItalic', 'extendedItalic', 'Italic Fallback'],
}
const lead = (variable: string) =>
  document.documentElement.style
    .getPropertyValue(variable)
    .split(',')[0]!
    .trim()

/** The document's faces: which were asked for, and which second names load. */
function fonts(asked: string[], loads: string[]) {
  const faces = asked.map((family) => ({ family, status: 'loaded' }))
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      [Symbol.iterator]: () => faces[Symbol.iterator](),
      load: (font: string) =>
        Promise.resolve(
          loads.some((name) => font.includes(`'${name}'`)) ? [{}] : []
        ),
    },
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  resetReadingFaces()
  document.documentElement.removeAttribute('style')
  document.documentElement.dataset.readingFaces = JSON.stringify({
    pairs,
    lists,
  })
})
afterEach(() => {
  vi.useRealTimers()
})

async function prepare() {
  prepareReadingFaces()
  await vi.runAllTimersAsync()
}

describe('the reading faces at a change of page', () => {
  it('switch nothing before any second name has loaded', () => {
    fonts(['Roman', 'Italic'], [])
    expect(upgradeAtPageChange(true, false)).toBe(false)
    expect(lead('--qt-face-read')).toBe('')
  })

  it('switch each face only once its second name has loaded', async () => {
    fonts(['Roman', 'Italic'], ['Roman Next'])
    await prepare()
    expect(upgradeAtPageChange(true, false)).toBe(true)
    expect(lead('--qt-face-read')).toBe("'Roman Next'")
    // The italic's second name has not loaded: its first name stays.
    expect(lead('--qt-face-read-italic')).toBe("'Italic'")
  })

  it('never load a face the document did not ask for', async () => {
    fonts(['Roman'], ['Roman Next', 'Italic Next'])
    await prepare()
    upgradeAtPageChange(true, false)
    expect(lead('--qt-face-read-italic')).toBe("'Italic'")
  })

  it('wait while a sheet or panel is on screen, and switch at the next change', async () => {
    fonts(['Roman'], ['Roman Next'])
    await prepare()
    expect(upgradeAtPageChange(true, true)).toBe(false)
    expect(lead('--qt-face-read')).toBe('')
    expect(upgradeAtPageChange(true, false)).toBe(true)
    expect(lead('--qt-face-read')).toBe("'Roman Next'")
  })

  it('never switch without a change of path', async () => {
    fonts(['Roman'], ['Roman Next'])
    await prepare()
    expect(upgradeAtPageChange(false, false)).toBe(false)
    expect(lead('--qt-face-read')).toBe('')
  })
})
