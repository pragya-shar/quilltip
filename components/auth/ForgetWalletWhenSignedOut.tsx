'use client'

import { useEffect } from 'react'
import { useConvexAuth } from 'convex/react'
import {
  browserStorage,
  forgetAllRememberedWallets,
} from '@/lib/wallet/remembered-wallet'

/**
 * On the sign-in pages, a signed-out browser keeps no reader's wallet choice
 * (#562). Sign-out sends the reader here, so this clears the choice even when
 * the wallet was not loaded on the page they signed out from. Loads no
 * wallet code.
 */
export function ForgetWalletWhenSignedOut() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  useEffect(() => {
    if (!isLoading && !isAuthenticated)
      forgetAllRememberedWallets(browserStorage())
  }, [isAuthenticated, isLoading])
  return null
}
