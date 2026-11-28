import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { PushedHeader } from '@/shell/PushedHeader'
import { PushedScreen } from '@/shell/PushedScreen'
import { SignInPage } from '@/components/signin/SignInPage'
import { returnPathFrom } from '@/lib/auth/returnPath'
import { EarlySubmitScript } from '@/components/auth/EarlySubmitScript'
import { NONCE_HEADER } from '@/lib/security/contentSecurityPolicy'

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: true },
}

/** With no script the form cannot sign anyone in: hide it and say so. */
const NO_SCRIPT_STYLE = '.qt-signin-page__live{display:none}'

type Search = Record<string, string | string[] | undefined>

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? null

/**
 * Sign in, as a page: where links to sign in land (older `/login` and
 * `/register` links redirect here), and the fallback when the sheet cannot
 * open. The return path is read on the server and must be a path on this
 * site. In the application, signing in is the sheet over the current page.
 */
export default async function SignInRoute({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const query = await searchParams
  const returnTo = returnPathFrom({ get: (name) => first(query[name]) })
  const mode = first(query.mode) === 'create' ? 'create' : 'sign-in'
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined
  return (
    <PushedScreen>
      <PushedHeader fallbackHref="/" backLabel="Back to Today" />
      <div className="qt-page qt-signin-page">
        {/* Holds a press made before the page script runs (the form is
            server HTML and can be sent before it is live). */}
        <EarlySubmitScript nonce={nonce} />
        <SignInPage returnTo={returnTo} initialMode={mode}>
          <noscript>
            <style>{NO_SCRIPT_STYLE}</style>
            <div className="qt-signin-page__noscript">
              <p className="qt-signin__switch">
                Signing in needs JavaScript, which is off in this browser. Turn
                it on and reload this page. Reading articles works without it.
              </p>
            </div>
          </noscript>
        </SignInPage>
      </div>
    </PushedScreen>
  )
}
