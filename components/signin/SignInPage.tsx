'use client'

import './signin.css'
import { useEffect, useState, type ReactNode } from 'react'
import { Heading } from '@/system/components/Heading'
import { useAuthPhase } from '@/hooks/auth/useAuthPhase'
import type { AuthMode } from '@/lib/auth/authErrors'
import { leaveWhenQuiet } from '@/lib/auth/leaveWhenQuiet'
import { sameSitePath } from '@/lib/auth/returnPath'
import { SignInForm } from './SignInForm'

/** How long a held session token may keep the form hidden while auth has
 * not answered; after that the form shows, so a slow backend never leaves
 * an empty page. */
export const HELD_WAIT_MS = 3_000

const HEADINGS: Record<AuthMode, string> = {
  'sign-in': 'Sign in to Quilltip',
  create: 'Create your account',
}

/**
 * The /signin page's working part: the heading and the same form as the
 * sheet. After a sign-in it goes back to the page the person came from (a
 * same-site path only), with a full page load so a page from either layout
 * gets the new session; that page shows any kept intent ready, and acts on
 * nothing. Someone who is already signed in never sees the form: the page
 * replaces itself with the way back. `children` is the no-script note,
 * shown under the heading.
 */
export function SignInPage({
  returnTo,
  initialMode,
  children,
}: {
  returnTo: string
  initialMode: AuthMode
  children?: ReactNode
}) {
  const phase = useAuthPhase()
  const destination = sameSitePath(returnTo)
  const [mode, setMode] = useState<AuthMode>(initialMode)
  // Whether the person was already signed in when the page opened; a
  // sign-in made here hands over to the form's own return.
  const [arrivedSignedIn, setArrivedSignedIn] = useState<boolean | null>(null)
  const [waitedLong, setWaitedLong] = useState(false)
  useEffect(() => {
    if (arrivedSignedIn === null && phase !== 'loading')
      setArrivedSignedIn(phase === 'signed-in')
  }, [arrivedSignedIn, phase])
  useEffect(() => {
    if (arrivedSignedIn)
      void leaveWhenQuiet(() => window.location.replace(destination))
  }, [arrivedSignedIn, destination])
  useEffect(() => {
    const id = window.setTimeout(() => setWaitedLong(true), HELD_WAIT_MS)
    return () => window.clearTimeout(id)
  }, [])
  // While a held token is being checked the form is hidden (CSS reads the
  // shell's session marker), so a signed-in arrival sees no flash of it.
  const state = arrivedSignedIn
    ? 'leaving'
    : phase === 'loading' && !waitedLong
      ? 'loading'
      : 'ready'
  return (
    <>
      <Heading level={1} variant="title">
        {HEADINGS[mode]}
      </Heading>
      {children}
      <div
        className="qt-signin-page__live"
        data-state={state}
        aria-busy={state !== 'ready' || undefined}
      >
        {arrivedSignedIn ? null : (
          <>
            <SignInForm
              initialMode={initialMode}
              onModeChange={setMode}
              onSignedIn={() =>
                void leaveWhenQuiet(() => window.location.assign(destination))
              }
              returnTo={destination}
            />
          </>
        )}
      </div>
    </>
  )
}
