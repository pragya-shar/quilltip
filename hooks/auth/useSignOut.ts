'use client'

import { useCallback } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import { clearIntent } from '@/lib/auth/intent'
import { signInSession } from '@/lib/auth/session'
import { browserStorage } from '@/lib/wallet/remembered-wallet'
import { signOutHere } from '@/shell/signOut/session'

/**
 * Signs out through the shell (`signOutHere`): while it runs no return path
 * or sign-in intent is written, and the packages' cleanups run once the
 * session has ended. The kept intent is cleared first, so nothing the
 * person was about to do waits for the next person on this browser.
 */
export function useSignOut() {
  const { signOut } = useAuthActions()
  return useCallback(async () => {
    signInSession.settle()
    clearIntent()
    await signOutHere(signOut, browserStorage())
  }, [signOut])
}
