'use client'

import { useState } from 'react'
import { Button } from '@/system/components/Button'
import { Dialog } from '@/system/components/Dialog'
import { browserStorage } from '@/lib/wallet/remembered-wallet'
import { signOutWarnings, type SignOutWarning } from './index'
import { signOutHere } from './session'

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
 * and "Stay". With nothing to say it signs out at once. A warning check
 * that fails or runs late never blocks; the cleanups run after either way
 * (`signOutHere`).
 */
export function SignOutControl({
  signOut,
  onSignedOut,
  warnings,
  limitMs,
}: SignOutControlProps) {
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
      const sentences = await signOutWarnings(warnings, limitMs)
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
