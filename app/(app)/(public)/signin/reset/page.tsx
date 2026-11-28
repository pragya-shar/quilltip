import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { EarlySubmitScript } from '@/components/auth/EarlySubmitScript'
import { NONCE_HEADER } from '@/lib/security/contentSecurityPolicy'
import { Heading } from '@/system/components/Heading'
import { PushedHeader } from '@/shell/PushedHeader'
import { PushedScreen } from '@/shell/PushedScreen'
import { ResetPassword } from '@/components/signin/ResetPassword'
import { returnPathFrom } from '@/lib/auth/returnPath'
// Not '@/shell/signIn': that module brings the sheet registry, and with it
// the sign-in sheet, into this page's first load.
import { signInHref } from '@/shell/signInHref'

export const metadata: Metadata = {
  title: 'Choose a new password',
  // Opened from an emailed link that carries a code: send no referrer.
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
}

/** With no script a reset cannot run: hide the form and say so. */
const NO_SCRIPT_STYLE = '.qt-signin-page__live{display:none}'

/**
 * Reset a password with an emailed code. Older reset links (/reset-password
 * and /forgot-password) redirect here; the code stays in the fragment. The
 * way back (`returnTo`) is carried to sign in afterwards.
 */
type Search = Record<string, string | string[] | undefined>

export default async function ResetRoute({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const query = await searchParams
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined
  const returnTo = returnPathFrom({
    get: (name) => {
      const value = query[name]
      return (Array.isArray(value) ? value[0] : value) ?? null
    },
  })
  return (
    <PushedScreen>
      <PushedHeader
        fallbackHref={signInHref(returnTo === '/' ? undefined : returnTo)}
        backLabel="Back to sign in"
      />
      <div className="qt-page qt-signin-page">
        {/* Holds a press made before the page script runs. */}
        <EarlySubmitScript nonce={nonce} />
        <Heading level={1} variant="title">
          Choose a new password
        </Heading>
        <noscript>
          <style>{NO_SCRIPT_STYLE}</style>
          <div className="qt-signin-page__noscript">
            <p className="qt-signin__switch">
              Resetting a password needs JavaScript, which is off in this
              browser. Turn it on and reload this page.
            </p>
          </div>
        </noscript>
        <div className="qt-signin-page__live">
          <ResetPassword returnTo={returnTo} />
        </div>
      </div>
    </PushedScreen>
  )
}
