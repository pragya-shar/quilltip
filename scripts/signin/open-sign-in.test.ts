import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { draftIntent, tipIntent } from '@/lib/auth/intent'
import { sheets } from '@/shell/sheets/signin'
import { sheetStack } from '@/shell/sheetStack'
import { SIGN_IN_SHEET, openSignIn } from '@/shell/signIn'

// openSignIn with what a surface passes: a built intent goes to the sheet;
// anything else is an error in development, and in production the sheet
// opens without it, never throwing.

const tip = tipIntent({
  path: '/theo/leave-it-overnight',
  articleId: 'a1b2c3',
  passage: { text: 'Leave it overnight.', startOffset: 0, endOffset: 19 },
  amount: { cents: 100, display: '$1.00', short: '$1' },
  writer: 'Theo Marsh',
})!

const top = () => sheetStack.get().at(-1)
const title = (props: unknown) =>
  (sheets['sign-in']!.title as (p: unknown) => string)(props)

describe('openSignIn', () => {
  beforeEach(() => {})
  afterEach(() => {
    sheetStack.closeAll()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('opens the sheet with a built intent', () => {
    expect(openSignIn(tip)).toBe(true)
    expect(top()).toMatchObject({ id: SIGN_IN_SHEET, open: true })
    expect((top()!.props as { intent: unknown }).intent).toEqual(tip)
  })

  it('opens in the form it is asked for, keeping the intent', () => {
    expect(openSignIn(tip, { mode: 'sign-in' })).toBe(true)
    expect(top()!.props).toEqual({ intent: tip, mode: 'sign-in' })
    sheetStack.closeAll()
    expect(openSignIn(null, { mode: 'nonsense' as never })).toBe(true)
    expect(top()!.props).toEqual({})
  })

  for (const env of ['production', 'development'])
    it(`in ${env}, never throws, and the title ignores an intent it cannot read`, () => {
      vi.stubEnv('NODE_ENV', env)
      const handMade = { kind: 'draft', draft: 'l-1' } as never
      expect(() => openSignIn(handMade)).not.toThrow()
      expect(top()).toMatchObject({ id: SIGN_IN_SHEET, open: true })
      expect(title(top()!.props)).toBe('Sign in to Quilltip')
      sheetStack.closeAll()
      const hostile = {
        get kind(): string {
          throw new Error('no')
        },
      } as never
      expect(() => openSignIn(hostile)).not.toThrow()
      expect(title(top()!.props)).toBe('Sign in to Quilltip')
    })
})

describe('the sheet title says the act', () => {
  it('names a draft to save, a tip and a plain sign-in', () => {
    expect(
      title({ intent: draftIntent({ path: '/write/l-1', draftId: 'l-1' }) })
    ).toBe('Save this draft')
    expect(title({ intent: tip })).toBe('Tip this line $1')
    expect(title({})).toBe('Sign in to Quilltip')
  })
})
