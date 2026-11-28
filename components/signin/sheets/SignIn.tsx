'use client'

import '../signin.css'
import { useEffect, useMemo } from 'react'
import type { SheetBodyProps } from '@/shell/sheets/types'
import { parseIntent, saveIntent, type SignInIntent } from '@/lib/auth/intent'
import { SignInForm } from '../SignInForm'

export type SignInProps =
  | { intent?: unknown; mode?: 'sign-in' | 'create' }
  | null
  | undefined

function lead(intent: SignInIntent | null): string | null {
  switch (intent?.kind) {
    case 'tip':
      return 'First, sign in or create a Quilltip account. Nothing is sent until you tap Tip again.'
    case 'keep':
      return 'Sign in to keep this line on every device.'
    case 'publish':
      return 'Sign in to publish. Your draft stays where it is.'
    case 'draft':
      return 'Sign in and it goes to your account. Until then it stays on this device.'
    case 'follow':
      return 'Sign in to follow. You can stop following at any time.'
    default:
      return null
  }
}

/**
 * The sign-in sheet (declared in shell/sheets/signin.ts; any surface opens
 * it with `openSignIn(intent)`). It keeps what the person was doing for
 * after sign-in, shows it at the top, signs in or creates an account, and
 * closes, leaving them where they were. It never acts on the intent: a tip
 * needs its own press afterwards.
 */
export default function SignInBody({
  props,
  close,
}: SheetBodyProps<SignInProps>) {
  const intent = useMemo(() => {
    try {
      return parseIntent(props?.intent)
    } catch {
      // A value whose reading throws is no intent.
      return null
    }
  }, [props])
  useEffect(() => {
    if (intent) saveIntent(intent)
    // A caller that built its intent by hand: the person still signs in,
    // without it; the caller's mistake is said where its author looks.
    else if (props?.intent)
      console.error(
        'openSignIn: that intent is not valid. Build it with tipIntent, keepIntent, publishIntent, followIntent or draftIntent from lib/auth/intent.'
      )
  }, [intent, props])
  const line = intent && 'passage' in intent ? intent.passage : null
  const words = lead(intent)
  return (
    <div className="qt-signin-sheet">
      {line ? (
        <p className="qt-signin-sheet__line">
          <span>{line.text}</span>
        </p>
      ) : null}
      {words ? <p className="qt-signin-sheet__lead">{words}</p> : null}
      <SignInForm
        idPrefix="signin-sheet"
        // Opened from an act (a tip, a keep, a follow, a publish), the
        // person is most likely new: the sheet starts with creating an
        // account. Opened plainly, or to save a draft whose session ended,
        // it starts with signing in.
        initialMode={
          props?.mode ??
          (intent && intent.kind !== 'draft' ? 'create' : 'sign-in')
        }
        onSignedIn={close}
        returnTo={`${window.location.pathname}${window.location.search}`}
      />
    </div>
  )
}
