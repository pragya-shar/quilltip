'use client'

import { useEffect } from 'react'
import { useConvexAuth } from 'convex/react'
import {
  browserStorage,
  forgetRememberedWallet,
} from '@/lib/wallet/remembered-wallet'

/**
 * On the sign-in pages, a signed-out browser keeps no reader's wallet choice
 * (#562): the next reader to sign in here does not get the last reader's
 * wallet back. Loads no wallet code.
 */
export function ForgetWalletWhenSignedOut() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  useEffect(() => {
    if (!isLoading && !isAuthenticated) forgetRememberedWallet(browserStorage())
  }, [isAuthenticated, isLoading])
  return null
}
