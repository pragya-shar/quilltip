'use client'

import { useCallback } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import { clearIntent } from '@/lib/auth/intent'
import { signInSession } from '@/lib/auth/session'
import { browserStorage } from '@/lib/wallet/remembered-wallet'
import { WARNING_LIMIT_MS } from '@/shell/signOut'
import { signOutHere } from '@/shell/signOut/session'
import { useSignOutViewer } from '@/shell/signOut/viewer'

/**
 * Signs out through the shell (`signOutHere`): while it runs no return path
 * or sign-in intent is written, and the packages' cleanups run once the
 * session has ended. The kept intent is cleared first, so nothing the
 * person was about to do waits for the next person on this browser. Who is
 * signing out comes from the shell, as for its own sign-out control; when
 * it does not answer in time, it is nobody, and nothing acts on a guess.
 */
export function useSignOut() {
  const { signOut } = useAuthActions()
  const viewer = useSignOutViewer()
  return useCallback(async () => {
    signInSession.settle()
    clearIntent()
    const userId = await Promise.race([
      viewer().catch(() => null),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), WARNING_LIMIT_MS)
      ),
    ])
    await signOutHere(signOut, browserStorage(), { userId })
  }, [signOut, viewer])
}
