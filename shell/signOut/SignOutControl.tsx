'use client'

import { useState } from 'react'
import { Button } from '@/system/components/Button'
import { Dialog } from '@/system/components/Dialog'
import { browserStorage } from '@/lib/wallet/remembered-wallet'
import { WARNING_LIMIT_MS, signOutWarnings, type SignOutWarning } from './index'
import { signOutHere } from './session'
import { useSignOutViewer, type SignOutViewer } from './viewer'

/** The signed-in user's id, or null when it is not known within `limitMs`. */
async function whoIsSigningOut(
  viewer: SignOutViewer,
  limitMs: number
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      viewer(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), limitMs)
      }),
    ])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

type SignOutControlProps = {
  /** Convex Auth's `useAuthActions().signOut`. */
  signOut: () => Promise<void>
  /** After the sign-out, where the surface goes next. */
  onSignedOut?: () => void
  /** The packages' warnings by default (shell/signOut/<package>.ts). */
  warnings?: readonly SignOutWarning[]
  limitMs?: number
}

/**
 * Sign out, asking first when a package says sign-out would strand
 * something: the dialog shows each sentence once, with "Sign out anyway"
 * and "Stay". With nothing to say it signs out at once. Each check gets
 * the signed-in user's id from the shell (`SignOutViewerContext`). A
 * warning check, or the id, that fails or runs late never blocks; the
 * cleanups run after either way (`signOutHere`).
 */
export function SignOutControl({
  signOut,
  onSignedOut,
  warnings,
  limitMs,
}: SignOutControlProps) {
  const viewer = useSignOutViewer()
  const [checking, setChecking] = useState(false)
  const [said, setSaid] = useState<string[] | null>(null)
  const [leaving, setLeaving] = useState(false)

  const leave = async () => {
    setLeaving(true)
    try {
      await signOutHere(signOut, browserStorage())
      onSignedOut?.()
    } finally {
      setLeaving(false)
      setSaid(null)
    }
  }

  const start = async () => {
    setChecking(true)
    try {
      // Who is signing out, from the shell, for every check.
      const limit = limitMs ?? WARNING_LIMIT_MS
      const userId = await whoIsSigningOut(viewer, limit)
      const sentences = await signOutWarnings(warnings, limit, { userId })
      if (sentences.length > 0) setSaid(sentences)
      else await leave()
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        loading={checking || (leaving && !said)}
        onClick={() => void start()}
      >
        Sign out
      </Button>
      <Dialog
        open={said !== null}
        onClose={() => setSaid(null)}
        role="alertdialog"
        title="Sign out?"
        description={said?.join(' ')}
        actions={
          <>
            <Button
              variant="danger"
              loading={leaving}
              onClick={() => void leave()}
            >
              Sign out anyway
            </Button>
            <Button variant="secondary" onClick={() => setSaid(null)}>
              Stay
            </Button>
          </>
        }
      />
    </>
  )
}
