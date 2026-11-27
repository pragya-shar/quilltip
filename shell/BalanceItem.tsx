'use client'

import { Icon } from '@/system/components/Icon'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { BalanceIcon } from '@/system/icons'
import { useBalanceReading } from './balance'
import { POCKET } from './navigation'
import { openSignIn } from './signIn'
import { sheetStack } from './sheetStack'
import { useSheets } from './useSheets'

/**
 * The fourth item: the balance, labelled with the live amount, or "Sign in"
 * when signed out. It is not a place: a press opens the Pocket over the
 * current page (a sheet on a phone, a panel on a desktop). It is a real
 * link, so with no script it goes to /pocket (or to sign in).
 */
export function BalanceItem({ className }: { className: string }) {
  const reading = useBalanceReading()
  const open = useSheets().some((entry) => entry.id === 'pocket' && entry.open)
  const signedOut = reading.auth === 'signed-out'
  const figure =
    reading.auth === 'loading'
      ? 'loading'
      : reading.status === 'ready' && reading.available
        ? 'value'
        : reading.status === 'loading'
          ? 'loading'
          : 'none'
  // "Balance" is a plain word for the item while no amount is known; the
  // product's name for the sheet is the design session's call.
  const label = signedOut
    ? 'Sign in'
    : figure === 'value'
      ? `Balance, ${reading.available!.display} ready to tip`
      : 'Balance'
  return (
    <a
      href={signedOut ? POCKET.signIn : POCKET.href}
      className={className}
      data-balance=""
      aria-label={label}
      aria-haspopup={signedOut ? undefined : 'dialog'}
      aria-expanded={signedOut ? undefined : open}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return
        if (signedOut) {
          // The sign-in sheet when a surface has registered it; else the link.
          if (openSignIn()) event.preventDefault()
          return
        }
        event.preventDefault()
        sheetStack.toggle('pocket')
      }}
    >
      <Icon icon={BalanceIcon} size={24} />
      <span className="qt-nav__label" aria-hidden="true">
        {signedOut ? (
          'Sign in'
        ) : figure === 'value' ? (
          <MoneyFigure value={reading.available} size="s" />
        ) : figure === 'loading' ? (
          <MoneyFigure value={null} status="loading" size="s" />
        ) : (
          'Balance'
        )}
      </span>
    </a>
  )
}
