'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { BadgeCheck, Globe, Lock, LogIn, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GATE_BUSY, gateCopy } from '@/lib/copy/payment-states'
import { shortAddress } from '@/lib/payments/format'
import { cn } from '@/lib/utils'
import { PaymentPanel } from './PaymentPanel'
import { PaymentSpinner } from './PaymentSpinner'
import { useAnnouncement } from './useAnnouncement'
import type {
  PaymentTone,
  WalletGateKind,
  WalletGateState,
} from './payment-types'
import './payments.css'

interface WalletGateProps {
  state: WalletGateState
  /** Rendered only when `state.kind` is `ready`. */
  children: ReactNode
  onSignIn?: () => void
  /** Opens the install help (the existing `InstallWalletDialog`). */
  onInstall?: () => void
  /** Connect, or reconnect after unlocking. */
  onConnect?: () => void
  /** Re-read the wallet network; falls back to `onConnect`. */
  onRecheck?: () => void
  /** Starts the ownership signature. */
  onVerify?: () => void
  /** Link to verify elsewhere, for example `/dashboard/wallet`. */
  verifyHref?: string
  /** The wallet prompt for the current action is open. */
  busy?: boolean
  /** Extra help under the prompt, for example `<WalletSetupHelp />`. */
  help?: ReactNode
  className?: string
}

type Blocked = Exclude<WalletGateKind, 'ready' | 'checking'>

const ICON: Record<Blocked, ReactNode> = {
  'signed-out': <LogIn />,
  'no-wallet': <Wallet />,
  disconnected: <Wallet />,
  locked: <Lock />,
  'wrong-network': <Globe />,
  unverified: <BadgeCheck />,
}

const TONE: Record<Blocked, PaymentTone> = {
  'signed-out': 'neutral',
  'no-wallet': 'neutral',
  disconnected: 'neutral',
  locked: 'warning',
  'wrong-network': 'warning',
  unverified: 'neutral',
}

/**
 * One prompt for everything between the user and a wallet-signed action:
 * signed out, no wallet, not connected, locked, wrong network and unverified
 * address. Children render only when the wallet is ready.
 *
 * The action button keeps its DOM node across states, so keyboard focus
 * stays on it when, say, "locked" turns into "wrong network".
 */
export function WalletGate({
  state,
  children,
  onSignIn,
  onInstall,
  onConnect,
  onRecheck,
  onVerify,
  verifyHref,
  busy = false,
  help,
  className,
}: WalletGateProps) {
  const address = state.kind === 'unverified' ? state.address : undefined
  const copy =
    state.kind === 'ready'
      ? null
      : gateCopy(state.kind, {
          walletNetwork:
            state.kind === 'wrong-network' ? state.walletNetwork : undefined,
          address: address ? shortAddress(address) : undefined,
        })

  // Announce a change of state once, through a region that already exists;
  // a region created with its text is often not read. The state present at
  // page load is not announced: it is read with the page.
  const message = copy ? `${copy.title}. ${copy.detail}` : ''
  const announcement = useAnnouncement(message)

  // When the gate opens after the user acted inside it, move focus to the
  // first control of the content (for example "Send tip"), so keyboard users
  // do not fall back to the top of the page.
  const root = useRef<HTMLDivElement>(null)
  const previousKind = useRef(state.kind)
  useEffect(() => {
    const was = previousKind.current
    previousKind.current = state.kind
    if (state.kind !== 'ready' || was === 'ready' || was === 'checking') return
    const node = root.current
    const active = document.activeElement
    if (!node || (active && active !== document.body && !node.contains(active)))
      return
    node
      .querySelector<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      ?.focus()
  }, [state.kind])

  // The wrapper and its live region stay mounted across every state, so a
  // change of state is announced and focus is not lost to a remount.
  const frame = (content: ReactNode) => (
    <div
      ref={root}
      className={cn('pay-gate', className)}
      data-gate={state.kind}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {content}
    </div>
  )

  if (state.kind === 'ready') return frame(children)

  if (state.kind === 'checking') {
    return frame(
      <p className="pay-inline-status">
        <PaymentSpinner />
        {copy!.title}
      </p>
    )
  }

  const kind = state.kind
  const handler: (() => void) | undefined = {
    'signed-out': onSignIn,
    'no-wallet': onInstall,
    disconnected: onConnect,
    locked: onConnect,
    'wrong-network': onRecheck ?? onConnect,
    unverified: onVerify,
  }[kind]
  const href = kind === 'unverified' && !onVerify ? verifyHref : undefined
  const label = busy ? GATE_BUSY : copy!.action

  let action: ReactNode = null
  if (label && href) {
    action = (
      <Button asChild className="pay-action" key="gate-action">
        <a href={href}>{label}</a>
      </Button>
    )
  } else if (label && handler) {
    action = (
      <Button
        type="button"
        className="pay-action"
        key="gate-action"
        // aria-disabled rather than disabled: a disabled button drops focus.
        onClick={busy ? undefined : handler}
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
      >
        {busy ? <PaymentSpinner /> : null}
        {label}
      </Button>
    )
  }

  return frame(
    <PaymentPanel
      tone={TONE[kind]}
      icon={ICON[kind]}
      title={copy!.title}
      actions={action}
      data-state={kind}
    >
      <p title={address}>{copy!.detail}</p>
      {help}
    </PaymentPanel>
  )
}
