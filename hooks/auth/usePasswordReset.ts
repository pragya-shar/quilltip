'use client'

import { useCallback, useRef, useState } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import {
  forgetResetEmail,
  rememberResetEmail,
  resetRequestErrorCopy,
  resetVerifyErrorCopy,
} from '@/lib/auth/passwordReset'
import { AUTH_MESSAGES } from '@/lib/auth/authErrors'

export type ResetFailure = {
  field: 'email' | 'code' | 'password' | null
  message: string
}

/** The server's error code (`ConvexError` data), or null. */
function codeOf(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = (error as { data: unknown }).data
    return typeof data === 'string' ? data : null
  }
  return null
}

const isNetwork = (error: unknown) =>
  error instanceof TypeError ||
  (typeof navigator !== 'undefined' && !navigator.onLine)

/**
 * Resetting a password with an emailed code: ask for a code, then set a new
 * password with it. The reset also signs this browser in; it signs out
 * again, so the journey ends with signing in with the new password, as on
 * every other device. One request at a time.
 */
export function usePasswordReset() {
  const { signIn, signOut } = useAuthActions()
  const [pending, setPending] = useState(false)
  const running = useRef(false)

  const once = useCallback(
    async <T>(work: () => Promise<T>): Promise<T | null> => {
      if (running.current) return null
      running.current = true
      setPending(true)
      try {
        return await work()
      } finally {
        running.current = false
        setPending(false)
      }
    },
    []
  )

  const requestCode = useCallback(
    (email: string) =>
      once(async (): Promise<ResetFailure | 'sent'> => {
        try {
          await signIn('password', { email: email.trim(), flow: 'reset' })
          rememberResetEmail(email)
          return 'sent'
        } catch (error) {
          if (isNetwork(error))
            return { field: null, message: AUTH_MESSAGES.network }
          return { field: null, message: resetRequestErrorCopy(codeOf(error)) }
        }
      }),
    [once, signIn]
  )

  const setNewPassword = useCallback(
    (details: { email: string; code: string; password: string }) =>
      once(async (): Promise<ResetFailure | 'done'> => {
        try {
          await signIn('password', {
            email: details.email.trim(),
            code: details.code,
            newPassword: details.password,
            flow: 'reset-verification',
          })
        } catch (error) {
          if (isNetwork(error))
            return { field: null, message: AUTH_MESSAGES.network }
          const code = codeOf(error)
          const message = resetVerifyErrorCopy(code)
          if (code === 'PASSWORD_RESET_INVALID_CODE')
            return { field: 'code', message }
          if (code === 'INVALID_PASSWORD')
            return { field: 'password', message: AUTH_MESSAGES.weakPassword }
          return { field: null, message }
        }
        await signOut().catch(() => undefined)
        forgetResetEmail()
        return 'done'
      }),
    [once, signIn, signOut]
  )

  return { requestCode, setNewPassword, pending }
}
