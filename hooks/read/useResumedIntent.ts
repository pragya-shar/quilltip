'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useConvexAuth } from 'convex/react'
import { takeIntent, type SignInIntent } from '@/components/read/signInIntent'

/**
 * MIRROR of the sign-in package's `useResumedIntent` (hooks/auth on
 * `feat/sign-in-sheet` at 4d7c97ed) until that branch is in this base: the
 * intent of this kind, once, after sign-in, on its own page (matched without
 * the query). The surface restores its own state from it and sends nothing.
 * The package's hook reads its auth phase; this base has Convex auth only.
 */
export function useResumedIntent<K extends SignInIntent['kind']>(
  kind: K
): Extract<SignInIntent, { kind: K }> | null {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const pathname = usePathname()
  const [intent, setIntent] = useState<Extract<
    SignInIntent,
    { kind: K }
  > | null>(null)
  useEffect(() => {
    if (isLoading || !isAuthenticated) return
    const taken = takeIntent(kind, pathname ?? window.location.pathname)
    if (taken) setIntent(taken)
  }, [isAuthenticated, isLoading, kind, pathname])
  return intent
}
