'use client'

import { useCallback, useRef, useState } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import {
  authFailure,
  type AuthFailure,
  type AuthMode,
} from '@/lib/auth/authErrors'
import { signInSession } from '@/lib/auth/session'

export type PasswordDetails = { email: string; password: string }

export type PasswordAuthResult =
  | { ok: true }
  | { ok: false; failure: AuthFailure }

/**
 * Signs in or creates an account with an email and a password. A second
 * submit while one is running is ignored. On success the session holds
 * "confirming" until the backend answers the new token. Creating an
 * account asks for nothing else and sends no money.
 */
export function usePasswordAuth() {
  const { signIn } = useAuthActions()
  const [pending, setPending] = useState(false)
  const running = useRef(false)
  const submit = useCallback(
    async (
      mode: AuthMode,
      details: PasswordDetails
    ): Promise<PasswordAuthResult | null> => {
      if (running.current) return null
      running.current = true
      setPending(true)
      try {
        await signIn('password', {
          email: details.email.trim(),
          password: details.password,
          flow: mode === 'create' ? 'signUp' : 'signIn',
        })
        signInSession.markSignedIn()
        return { ok: true }
      } catch (error) {
        return {
          ok: false,
          failure: authFailure(
            error,
            mode,
            typeof navigator === 'undefined' ? true : navigator.onLine
          ),
        }
      } finally {
        running.current = false
        setPending(false)
      }
    },
    [signIn]
  )
  return { submit, pending }
}
