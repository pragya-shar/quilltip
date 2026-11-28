/**
 * The no-script reading check lets a package list a protected old page that
 * a signed-out reader no longer reaches at sign-in (signedOutLanding). Each
 * entry must be a real redirect to its landing page, so the list can never
 * excuse a page that still needs to send the reader to sign in.
 */
import { describe, expect, it } from 'vitest'
import { SIGN_IN_BACK } from '../../components/pocket/signInBack'
import { redirectFor } from '../../lib/routing/redirects'
import { POCKET } from '../../shell/navigation'
import { signInHref } from '../../shell/signIn'
import { SIGNED_OUT_LANDING } from '../perf/routes'

describe('signed-out landings', () => {
  it('lists /dashboard, which lands on /pocket', () => {
    expect(SIGNED_OUT_LANDING).toContainEqual({
      path: '/dashboard',
      endsAt: '/pocket',
      signInLink: 'Sign in',
    })
  })

  it('names only paths that redirect to their landing page', () => {
    for (const entry of SIGNED_OUT_LANDING) {
      const target = redirectFor(new URL(entry.path, 'http://quilltip.test'))
      expect(target?.pathname, entry.path).toBe(entry.endsAt)
    }
  })

  it("/pocket's sign-in link is the shell's, back to /pocket", () => {
    expect(SIGN_IN_BACK).toBe(signInHref(POCKET.href))
    expect(SIGN_IN_BACK).toBe('/login?returnTo=%2Fpocket')
  })
})
