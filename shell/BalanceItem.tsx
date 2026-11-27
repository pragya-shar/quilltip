'use client'

import { Icon } from '@/system/components/Icon'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { BalanceIcon } from '@/system/icons'
import { figureState, spokenValue } from '@/system/money/figure'
import { useBalanceReading } from './balance'
import { POCKET } from './navigation'
import { warmPocket } from './pocket/loadPocket'
import { openSignIn } from './signIn'
import { sheetStack } from './sheetStack'
import { useSheets } from './useSheets'

/**
 * The fourth item: the balance. It is not a place: a press opens it over
 * the current page (a sheet on a phone, a panel on a desktop).
 *
 * Its label sits in a fixed slot (86 px), the same width in every state:
 * - before auth is known, as the server sends it and with no script: "Sign
 *   in", a real link to sign in (with no script nobody can be signed in);
 *   when the pre-paint script found a session token (`data-session` on
 *   <html>), it shows "Balance" instead, so a signed-in person never sees
 *   "Sign in" flash;
 * - signed out: "Sign in";
 * - signed in: the amount ("≈ $18.40" when it is a conversion), or
 *   "Balance" while it loads or when payments cannot answer.
 * A screen reader hears "Balance, about 18 dollars 40. Open balance".
 */
export function BalanceItem({ className }: { className: string }) {
  const reading = useBalanceReading()
  const open = useSheets().some((entry) => entry.id === 'pocket' && entry.open)
  const unknown = reading.auth === 'loading'
  const signedOut = reading.auth === 'signed-out'
  const state =
    reading.auth === 'signed-in' && reading.status === 'ready'
      ? figureState(reading.available)
      : null
  const parts = state?.kind === 'value' ? state.parts : null
  const words =
    parts && reading.auth === 'signed-in' && reading.available
      ? spokenValue(reading.available)
      : null
  const label = signedOut
    ? 'Sign in'
    : words
      ? `Balance, ${words}. Open balance`
      : unknown
        ? undefined
        : 'Balance. Open balance'
  return (
    <a
      href={signedOut || unknown ? POCKET.signIn : POCKET.href}
      className={className}
      data-balance=""
      aria-label={label}
      aria-haspopup={signedOut || unknown ? undefined : 'dialog'}
      aria-expanded={signedOut || unknown ? undefined : open}
      onPointerEnter={signedOut ? undefined : warmPocket}
      onFocus={signedOut ? undefined : warmPocket}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return
        if (signedOut) {
          // The sign-in sheet when a surface has registered it; else the link.
          if (openSignIn()) event.preventDefault()
          return
        }
        if (unknown) return
        event.preventDefault()
        sheetStack.toggle('pocket')
      }}
    >
      <Icon icon={BalanceIcon} size={24} />
      <span className="qt-nav__label qt-balance-slot">
        {unknown ? (
          <>
            <span data-when="signed-out">Sign in</span>
            <span data-when="held">Balance</span>
          </>
        ) : signedOut ? (
          'Sign in'
        ) : parts ? (
          <span aria-hidden="true">
            <MoneyFigure value={reading.available} size="s" />
          </span>
        ) : (
          'Balance'
        )}
      </span>
    </a>
  )
}
