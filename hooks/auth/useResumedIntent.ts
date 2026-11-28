'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { takeIntent, type SignInIntent } from '@/lib/auth/intent'
import { useAuthPhase } from './useAuthPhase'

/**
 * The intent of this kind the person signed in with, once, on its own page:
 * the surface that owns the kind restores its own state from it (the
 * article view chooses the line and sets the amount within the intent's
 * ceiling) and sends nothing. Null until the person is signed in, and for
 * an intent of another kind, for another page, or expired. It survives a
 * full page load between opening the sheet and signing in.
 */
export function useResumedIntent<K extends SignInIntent['kind']>(
  kind: K
): Extract<SignInIntent, { kind: K }> | null {
  const phase = useAuthPhase()
  const pathname = usePathname()
  const [intent, setIntent] = useState<Extract<
    SignInIntent,
    { kind: K }
  > | null>(null)
  useEffect(() => {
    if (phase !== 'signed-in') return
    const taken = takeIntent(kind, pathname ?? window.location.pathname)
    if (taken) setIntent(taken)
  }, [phase, kind, pathname])
  return intent
}
