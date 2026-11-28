'use client'

import { useEffect, useSyncExternalStore, type MouseEvent } from 'react'
import { Icon } from '@/system/components/Icon'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { BalanceIcon } from '@/system/icons'
import { figureState, spokenValue } from '@/system/money/figure'
import { useBalanceReading } from './balance'
import { POCKET } from './navigation'
import { warmPocket } from './pocket/loadPocket'
import { SESSION_ATTR, hasAuthToken } from './prePaint'
import { openSignIn } from './signIn'
import { sheetStack } from './sheetStack'
import { useSheets } from './useSheets'

/**
 * The fourth item: the balance. It is not a place: a press opens it over
 * the current page (a sheet on a phone, a panel on a desktop).
 *
 * It is the same two links in every state, and the session marker on
 * <html> shows one. Its label sits in a fixed slot (86 px), the same width
 * in every state:
 * - before auth is known, as the server sends it and with no script: the
 *   pre-paint marker chooses. "Sign in", a real link to
 *   sign in (with no script nobody can be signed in); when the pre-paint
 *   script found a session token (`data-session` on <html>), "Balance", a
 *   link to /pocket, so a signed-in person never sees "Sign in" flash, and a
 *   press before the scripts run opens their balance, not the sign-in page;
 * - signed out: "Sign in";
 * - signed in: the amount ("≈ $18.40" when it is a conversion), or
 *   "Balance" while it loads or when payments cannot answer.
 * A screen reader hears "Balance, about 18 dollars 40. Open balance".
 */
const noSubscribe = () => () => {}
const tokenHeld = () => {
  try {
    return hasAuthToken(window.localStorage)
  } catch {
    return false
  }
}

export function BalanceItem({ className }: { className: string }) {
  const reading = useBalanceReading()
  // While auth loads: a held session token means the person is almost
  // surely signed in, so a press opens the balance (it waits there,
  // neutral) instead of following the sign-in link. False on the server and
  // with no script, where the link is right.
  const held = useSyncExternalStore(noSubscribe, tokenHeld, () => false)
  // Once auth answers, the marker the pre-paint script set from a stored
  // token follows the answer: what shows before auth (this item's word, the
  // /pocket page's prompt or balance) is right after it too.
  // Before it answers, a held token sets it as the pre-paint script does,
  // where none ran.
  useEffect(() => {
    const root = document.documentElement
    if (reading.auth === 'signed-in' || (reading.auth === 'loading' && held))
      root.setAttribute(SESSION_ATTR, 'held')
    else if (reading.auth === 'signed-out') root.removeAttribute(SESSION_ATTR)
  }, [reading.auth, held])
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
  const label = words
    ? `Balance, ${words}. Open balance`
    : 'Balance. Open balance'
  const modified = (event: MouseEvent<HTMLAnchorElement>) =>
    event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
  // Always the same two links, in every state, and the session marker on
  // <html> shows one (shell/shell.css): the item kept no element when auth
  // answered, and a press that went down on the old link and up on the new
  // one made no click, so the first tap after a full load was lost. The
  // marker follows auth (the effect above), so the right link shows once it
  // answers; until then, the pre-paint marker chose.
  return (
    <span className="qt-balance-switch" data-session-switch="">
      <a
        href={POCKET.signIn}
        className={className}
        data-balance=""
        data-when="signed-out"
        onClick={(event) => {
          if (modified(event)) return
          // The sign-in sheet when a surface has registered it; else the link.
          if (signedOut && openSignIn()) event.preventDefault()
        }}
      >
        <Icon icon={BalanceIcon} size={24} />
        <span className="qt-nav__label qt-balance-slot">Sign in</span>
      </a>
      <a
        href={POCKET.href}
        className={className}
        data-balance=""
        data-when="held"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={warmPocket}
        onFocus={warmPocket}
        onClick={(event) => {
          if (modified(event)) return
          // Signed in, or a session token held while auth loads (the
          // balance opens and waits there, neutral): over the page.
          if (!(reading.auth === 'signed-in' || (unknown && held))) return
          event.preventDefault()
          sheetStack.toggle('pocket')
        }}
      >
        <Icon icon={BalanceIcon} size={24} />
        <span className="qt-nav__label qt-balance-slot">
          {parts ? (
            <span aria-hidden="true">
              <MoneyFigure value={reading.available} size="s" />
            </span>
          ) : (
            'Balance'
          )}
        </span>
      </a>
    </span>
  )
}
