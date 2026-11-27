import { describe, expect, test } from 'vitest'
import { READING_PLACE_KEY } from '../../components/today/readingPlace'
import {
  ROWS_MEMORY_KEY,
  reservation,
  reserveScript,
} from '../../components/today/rowsMemory'
import { PRE_PAINT_SCRIPT } from '../../shell/prePaint'
import { currentPlace } from '../../components/today/resume'
import { isSitePath, parsePlaces } from '../../components/today/readingPlace'

/** A storage over a plain record, as the inline script and the island see it. */
function storage(items: Record<string, string>): Storage {
  const keys = Object.keys(items)
  return {
    get length() {
      return keys.length
    },
    key: (i: number) => keys[i] ?? null,
    getItem: (k: string) => items[k] ?? null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  }
}

/**
 * Runs the shell's pre-paint script, then Today's, as the page does, and
 * returns what Today reserved and whether the shell marked a session.
 */
function runScripts(items: Record<string, string>) {
  const attrs = new Map<string, string>()
  const root = {
    dataset: {} as Record<string, string>,
    setAttribute: (name: string, value: string) => attrs.set(name, value),
    getAttribute: (name: string) => attrs.get(name) ?? null,
  }
  const document = { documentElement: root }
  const store = storage(items)
  new Function('localStorage', 'document', PRE_PAINT_SCRIPT)(store, document)
  new Function('localStorage', 'document', reserveScript(READING_PLACE_KEY))(
    store,
    document
  )
  return {
    sessionHeld: attrs.get('data-session') === 'held',
    reserved: {
      place: attrs.has('data-today-place'),
      draft: attrs.has('data-today-draft'),
    },
  }
}

const place = (over: object = {}) => ({
  articleId: 'k57a1b2c3d4e5f6g7',
  href: '/noor/kitchen',
  title: 'Notes on a borrowed kitchen',
  sentence: 'Every kitchen has a drawer.',
  percent: 0.46,
  updatedAt: 2,
  finished: false,
  ...over,
})

const cases: [string, Record<string, string>][] = [
  ['nothing stored', {}],
  ['a started place', { [READING_PLACE_KEY]: JSON.stringify([place()]) }],
  [
    'a finished place',
    { [READING_PLACE_KEY]: JSON.stringify([place({ finished: true })]) },
  ],
  [
    'a title of spaces',
    { [READING_PLACE_KEY]: JSON.stringify([place({ title: '   ' })]) },
  ],
  [
    'a title of the letter s',
    { [READING_PLACE_KEY]: JSON.stringify([place({ title: 'ss' })]) },
  ],
  [
    'an off-site link',
    { [READING_PLACE_KEY]: JSON.stringify([place({ href: '//evil.test/x' })]) },
  ],
  [
    'a backslash link',
    {
      [READING_PLACE_KEY]: JSON.stringify([place({ href: '/\\evil.test/x' })]),
    },
  ],
  [
    'a tab link',
    {
      [READING_PLACE_KEY]: JSON.stringify([place({ href: '/\t/evil.test/x' })]),
    },
  ],
  [
    'a newline link',
    {
      [READING_PLACE_KEY]: JSON.stringify([place({ href: '/\n/evil.test/x' })]),
    },
  ],
  [
    '20 valid finished places before an unfinished one',
    {
      [READING_PLACE_KEY]: JSON.stringify([
        { bad: true },
        ...Array.from({ length: 20 }, (_, i) =>
          place({ articleId: `done${i}`, finished: true, percent: 1 })
        ),
        place(),
      ]),
    },
  ],
  [
    'an unfinished place after an invalid one',
    {
      [READING_PLACE_KEY]: JSON.stringify([
        place({ href: '/\\evil.test/x' }),
        place({ articleId: 'k2' }),
      ]),
    },
  ],
  [
    'not started',
    { [READING_PLACE_KEY]: JSON.stringify([place({ percent: 0 })]) },
  ],
  ['corrupt places', { [READING_PLACE_KEY]: '{not json' }],
  ['a remembered draft, signed out', { [ROWS_MEMORY_KEY]: '{"draft":true}' }],
  [
    'a remembered draft with a session',
    { [ROWS_MEMORY_KEY]: '{"draft":true}', __convexAuthJWT_x: 't' },
  ],
  ['a session, no draft shown before', { __convexAuthJWT_x: 't' }],
]

describe('the pre-paint script reserves what the rows island will show', () => {
  test.each(cases)('%s', (_, items) => {
    const { sessionHeld, reserved } = runScripts(items)
    const expected = reservation(
      sessionHeld,
      storage(items),
      currentPlace(parsePlaces(items[READING_PLACE_KEY] ?? null)) !== null
    )
    expect(reserved).toEqual(expected)
  })

  test('the cases cover both rows reserved and not', () => {
    const results = cases.map(([, items]) => runScripts(items).reserved)
    expect(results.some((r) => r.place)).toBe(true)
    expect(results.some((r) => r.draft)).toBe(true)
    expect(results.some((r) => !r.place && !r.draft)).toBe(true)
  })
})

describe('a stored link is used only when it stays on this site', () => {
  test.each([
    ['/noor/kitchen', true],
    ['/noor/kitchen?highlight=1#s-2-0', true],
    ['//evil.test/x', false],
    ['/\\evil.test/x', false],
    ['/\t/evil.test/x', false],
    ['/\n/evil.test/x', false],
    ['/\u0000/x', false],
    ['https://evil.test/x', false],
    ['javascript:alert(1)', false],
    ['noor/kitchen', false],
  ])('%j is a site path: %s', (href, ok) => {
    expect(isSitePath(href)).toBe(ok)
  })
})
