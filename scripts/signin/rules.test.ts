import { beforeEach, describe, expect, it } from 'vitest'
import { AUTH_MESSAGES, authFailure } from '@/lib/auth/authErrors'
import {
  INTENT_KEY,
  INTENT_TTL_MS,
  amountWithin,
  clearIntent,
  followIntent,
  keepIntent,
  parseIntent,
  publishIntent,
  readIntent,
  tipIntent,
  saveIntent,
  takeIntent,
} from '@/lib/auth/intent'
import {
  RETURN_PATH_MAX,
  legacyReturnPathFrom,
  returnPathFrom,
  sameSitePath,
} from '@/lib/auth/returnPath'
import { CONFIRM_MS, authPhase } from '@/lib/auth/session'
import { resetHref } from '@/components/signin/resetHref'
import { makeRedirector } from '@/lib/routing/redirects'
import { redirects as signinRedirects } from '@/lib/routing/redirects/signin'
import { SIGNED_IN_MARKER, setSigningOut } from '@/shell/signOut/state'

// sessionStorage for the node environment.
class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string) {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null
  }
  get length() {
    return this.map.size
  }
}
const store = new MemoryStorage()
const local = new MemoryStorage()
;(globalThis as unknown as { window: unknown }).window = {
  sessionStorage: store,
  localStorage: local,
}

const tip = {
  kind: 'tip',
  path: '/theo/leave-it-overnight',
  articleId: 'j57a8b9c0d1e2f3',
  passage: { text: 'Leave it overnight.', startOffset: 120, endOffset: 139 },
  amount: { cents: 100, display: '$1.00' },
  writer: 'Theo Marsh',
}

describe('return paths are same-site paths only', () => {
  it.each([
    '/',
    '/theo/leave-it-overnight',
    '/pocket?tab=x#y',
    '/search?q=a%20b',
  ])('keeps %s', (path) => {
    expect(sameSitePath(path)).toBe(path)
  })

  it.each([
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'evil.example',
    '/%2F%2Fevil.example',
    '/%5Cevil.example',
    '%2F%2Fevil.example',
    '/%252F%252Fevil.example',
    '/x\u0000y',
    '/x\ny',
    '/%0d%0aSet-Cookie:x',
    `/${'a'.repeat(RETURN_PATH_MAX)}`,
    '',
    '   ',
  ])('refuses %j', (path) => {
    expect(sameSitePath(path, '/fallback')).toBe('/fallback')
  })

  it('refuses what is not a string', () => {
    expect(sameSitePath(undefined)).toBe('/')
    expect(sameSitePath({ toString: () => '/x' })).toBe('/')
  })

  const params = (o: Record<string, string>) => ({
    get: (k: string) => o[k] ?? null,
  })

  it('reads returnTo only on /signin and /signin/reset, checked again', () => {
    expect(returnPathFrom(params({ returnTo: '/a' }))).toBe('/a')
    expect(returnPathFrom(params({ returnTo: '/a?b=1' }))).toBe('/a?b=1')
    expect(returnPathFrom(params({ returnTo: '//x' }))).toBe('/')
    expect(returnPathFrom(params({ returnTo: '/%2F%2Fx' }))).toBe('/')
    // Never back to the sign-in pages: a signed-in arrival there leaves.
    for (const returnTo of [
      '/signin',
      '/signin/reset',
      '/SignIn/',
      '/%73ignin',
      '/signin?returnTo=%2Fa',
    ])
      expect(returnPathFrom(params({ returnTo })), returnTo).toBe('/')
    expect(returnPathFrom(params({ returnTo: '/signing' }))).toBe('/signing')
    // next and redirect were never written to /signin.
    expect(returnPathFrom(params({ next: '/b' }))).toBe('/')
    expect(returnPathFrom(params({ redirect: '/b' }))).toBe('/')
  })

  it('reads the three older names on links to the older pages', () => {
    expect(legacyReturnPathFrom(params({ returnTo: '/a', next: '/b' }))).toBe(
      '/a'
    )
    expect(legacyReturnPathFrom(params({ returnTo: '//x', next: '/b' }))).toBe(
      '/b'
    )
    expect(legacyReturnPathFrom(params({ redirect: '/c' }))).toBe('/c')
    expect(legacyReturnPathFrom(params({ redirect: 'https://x' }))).toBe('/')
  })

  it('writes the way back to the reset page, and back to sign in', () => {
    expect(resetHref()).toBe('/signin/reset')
    expect(resetHref('/')).toBe('/signin/reset')
    expect(resetHref('/a/b')).toBe('/signin/reset?returnTo=%2Fa%2Fb')
    expect(resetHref('//evil.example')).toBe('/signin/reset')
  })
})

describe('an intent is validated, bounded and expires', () => {
  beforeEach(() => {
    clearIntent()
    setSigningOut(false)
    local.removeItem(SIGNED_IN_MARKER)
    local.removeItem('__convexAuthJWT_x')
  })

  it('keeps a valid intent and gives it back once, for its own page', () => {
    expect(saveIntent(tip, 1_000)).toBe(true)
    expect(takeIntent('tip', '/elsewhere', 2_000)).toBeNull()
    expect(takeIntent('keep', tip.path, 2_000)).toBeNull()
    expect(takeIntent('tip', tip.path, 2_000)).toEqual(tip)
    expect(readIntent(2_000)).toBeNull()
  })

  it('expires', () => {
    saveIntent(tip, 0)
    expect(readIntent(INTENT_TTL_MS)).toEqual(tip)
    expect(readIntent(INTENT_TTL_MS + 1)).toBeNull()
    // And an expired one is cleared.
    expect(store.getItem(INTENT_KEY)).toBeNull()
  })

  it('refuses unsafe paths, odd ids, amounts out of range and oversized text', () => {
    for (const bad of [
      { ...tip, path: '//evil.example' },
      { ...tip, path: 'https://evil.example/x' },
      { ...tip, articleId: '../x' },
      { ...tip, amount: { cents: 0, display: '$0.00' } },
      { ...tip, amount: { cents: 1.5, display: '$0.015' } },
      { ...tip, amount: { cents: 5_001, display: '$50.01' } },
      {
        ...tip,
        passage: { text: 'x'.repeat(601), startOffset: 0, endOffset: 1 },
      },
      { ...tip, passage: { text: 'x', startOffset: 5, endOffset: 5 } },
      { ...tip, kind: 'send' },
      null,
      'tip',
    ])
      expect(saveIntent(bad), JSON.stringify(bad).slice(0, 60)).toBe(false)
  })

  it('drops a stored value that was tampered with', () => {
    store.setItem(
      INTENT_KEY,
      JSON.stringify({
        v: 1,
        savedAt: Date.now(),
        intent: { ...tip, path: '//evil.example' },
      })
    )
    expect(readIntent()).toBeNull()
    store.setItem(INTENT_KEY, 'not json')
    expect(readIntent()).toBeNull()
    store.setItem(INTENT_KEY, 'x'.repeat(5_000))
    expect(readIntent()).toBeNull()
  })

  it('writes nothing while the person is signing out', () => {
    setSigningOut(true)
    expect(saveIntent(tip)).toBe(false)
    setSigningOut(false)
    expect(saveIntent(tip)).toBe(true)
  })

  it('writes nothing while a sign-out elsewhere is unfinished', () => {
    // The shell's marker says this browser was signed in, and the token is
    // gone: the cleanups have not run yet.
    local.setItem(SIGNED_IN_MARKER, '1')
    expect(saveIntent(tip)).toBe(false)
    local.setItem('__convexAuthJWT_x', 'token')
    expect(saveIntent(tip)).toBe(true)
  })

  it('keeps the kinds it knows, and only their fields', () => {
    expect(
      parseIntent({ kind: 'publish', path: '/write/abc', draftId: 'abc', x: 1 })
    ).toEqual({ kind: 'publish', path: '/write/abc', draftId: 'abc' })
    expect(
      parseIntent({
        kind: 'keep',
        path: '/a/b',
        articleId: 'a1',
        passage: null,
      })
    ).toBeNull()
  })
})

describe("an intent's amount is a ceiling, never raised", () => {
  it('takes the largest choice at or below it', () => {
    expect(amountWithin(100, [10, 25, 50, 100, 500])).toBe(100)
    expect(amountWithin(75, [10, 25, 50, 100])).toBe(50)
    expect(amountWithin(5, [10, 25])).toBeNull()
  })
})

describe('errors are plain and specific', () => {
  it('tells a network failure from a wrong password', () => {
    expect(authFailure(new TypeError('Failed to fetch'), 'sign-in')).toEqual({
      field: null,
      message: AUTH_MESSAGES.network,
    })
    expect(authFailure(new Error('x'), 'sign-in', false).message).toBe(
      AUTH_MESSAGES.network
    )
    expect(authFailure(new Error('InvalidSecret'), 'sign-in')).toEqual({
      field: 'password',
      message: AUTH_MESSAGES.wrongPassword,
    })
    // A missing account reads the same as a wrong password.
    expect(authFailure(new Error('InvalidAccountId'), 'sign-in')).toEqual(
      authFailure(new Error('InvalidSecret'), 'sign-in')
    )
  })

  it('says an email is in use, or a password is too weak, on sign-up', () => {
    expect(
      authFailure(new Error('Account test@x.com already exists'), 'create')
    ).toEqual({
      field: 'email',
      message: AUTH_MESSAGES.emailInUse,
      code: 'email-in-use',
    })
    expect(authFailure({ data: 'INVALID_PASSWORD' }, 'create')).toEqual({
      field: 'password',
      message: AUTH_MESSAGES.weakPassword,
    })
  })

  it('says plainly that nothing was sent, and on sign-up that no account was made', () => {
    for (const mode of ['sign-in', 'create'] as const)
      for (const error of [new TypeError('Failed to fetch'), new Error('x')]) {
        const message = authFailure(error, mode).message
        expect(message).toContain('nothing was sent')
        if (mode === 'create') expect(message).toContain('no account was made')
      }
    expect(authFailure(new TypeError('x'), 'create').message).toBe(
      AUTH_MESSAGES.networkCreate
    )
  })

  it('never shows raw server text', () => {
    const raw =
      '[CONVEX A(auth:signIn)] [Request ID: 1] Server Error\n  at handler'
    expect(authFailure(new Error(raw), 'sign-in').message).toBe(
      AUTH_MESSAGES.generic
    )
  })
})

describe('right after a sign-in, not-yet-answered is not signed out', () => {
  const out = { isLoading: false, isAuthenticated: false }
  it('reads confirming for a while, then signed out', () => {
    expect(authPhase(out, 1_000, 1_000 + CONFIRM_MS - 1)).toBe('confirming')
    expect(authPhase(out, 1_000, 1_000 + CONFIRM_MS)).toBe('signed-out')
    expect(authPhase(out, null, 0)).toBe('signed-out')
    expect(
      authPhase({ isLoading: false, isAuthenticated: true }, 1_000, 1_001)
    ).toBe('signed-in')
    expect(authPhase({ isLoading: true, isAuthenticated: false }, null)).toBe(
      'loading'
    )
  })
})

describe('older sign-in links', () => {
  const to = (path: string) =>
    makeRedirector(signinRedirects)(new URL(path, 'https://q.test'))?.href

  it('keep only a validated return path, as returnTo', () => {
    expect(to('/login?next=%2Fshelf&utm=x&code=1')).toBe(
      'https://q.test/signin?returnTo=%2Fshelf'
    )
    expect(to('/login?redirect=%2Fread%2Fa&returnTo=%2F%2Fevil.test')).toBe(
      'https://q.test/signin?returnTo=%2Fread%2Fa'
    )
    expect(to('/login?next=https%3A%2F%2Fevil.test&x=1')).toBe(
      'https://q.test/signin'
    )
    expect(to('/login?next=javascript:alert(1)')).toBe('https://q.test/signin')
  })

  it('open creating an account from /register', () => {
    expect(to('/register?next=%2Fwrite&ref=y')).toBe(
      'https://q.test/signin?mode=create&returnTo=%2Fwrite'
    )
  })

  it('carry nothing from the query to reset password', () => {
    expect(to('/reset-password?code=12345678&email=a%40b.c')).toBe(
      'https://q.test/signin/reset'
    )
    expect(to('/forgot-password?email=a%40b.c')).toBe(
      'https://q.test/signin/reset'
    )
  })
})

describe('intents are built by the contract’s builders', () => {
  beforeEach(() => clearIntent())

  it('builds each kind from exactly its fields', () => {
    const { kind: _kind, ...fields } = tip
    expect(tipIntent(fields)).toEqual(tip)
    expect(
      tipIntent({
        ...fields,
        amount: { cents: 100, display: '$1.00', short: '$1' },
      })?.amount
    ).toEqual({ cents: 100, display: '$1.00', short: '$1' })
    expect(
      keepIntent({
        path: tip.path,
        articleId: tip.articleId,
        passage: tip.passage,
      })
    ).toMatchObject({ kind: 'keep', passage: tip.passage })
    expect(publishIntent({ path: '/write/abc', draftId: 'abc' })).toEqual({
      kind: 'publish',
      path: '/write/abc',
      draftId: 'abc',
    })
    expect(
      followIntent({ path: '/theo', writerId: 'w1', writer: 'Theo Marsh' })
    ).toMatchObject({ kind: 'follow', writer: 'Theo Marsh' })
  })

  it('returns null for input that is not valid', () => {
    const { kind: _kind, ...fields } = tip
    expect(tipIntent({ ...fields, path: '//evil.example' })).toBeNull()
    expect(
      tipIntent({ ...fields, amount: { cents: 0, display: '$0.00' } })
    ).toBeNull()
    // The article view's earlier shape (start and end) is refused.
    expect(
      parseIntent({
        ...tip,
        passage: { text: 'Leave it overnight.', start: 120, end: 139 },
      })
    ).toBeNull()
  })

  it('a resumed intent matches its page whatever the query', () => {
    expect(saveIntent(tip)).toBe(true)
    expect(takeIntent('tip', `${tip.path}?from=today`)).toEqual(tip)
  })
})
