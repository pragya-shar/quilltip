'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/system/components/Button'
import { Icon } from '@/system/components/Icon'
import { KeepButton } from '@/system/components/KeepButton'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { TestnetNote } from '@/system/components/TestnetNote'
import { TipControl } from '@/system/components/TipControl'
import { DoneIcon, TipIcon } from '@/system/icons'
import { useBalanceReading } from '@/shell/balance'
import { Dock } from '@/shell/Dock'
import { sheetFor } from '@/shell/sheetRegistry'
import { declaredSheet } from '@/shell/sheets'
import { sheetStack } from '@/shell/sheetStack'
import { openSignIn } from '@/shell/signIn'
import { preloadSheet } from '@/shell/sheets/loadSheet'
import { RECEIPT_SHEET, type ReceiptProps } from './receipt'
import type { ChosenPassage } from '@/hooks/read/usePassageSelection'
import {
  useTip,
  type Money,
  type TipMeta,
  type TipTarget,
  type UnavailableReason,
} from '@/hooks/read/payments'
import type { ReadArticle } from './readModel'

/** What a tip that the server accepted was for. */
export type SentTip = {
  requestId: string
  amount: Money
  passage: ChosenPassage | null
}

type TipBarProps = {
  article: ReadArticle
  passage: ChosenPassage | null
  onClear: () => void
  /** Whether the chosen line is kept, and a save is under way. */
  kept: boolean
  keepPending: boolean
  /** Keeps the chosen line, or lets it go. */
  onKeepChange: (keep: boolean) => void
  /** True while a tip is held, queued or sending: lines must not change. */
  onLockChange: (locked: boolean) => void
  /** Once per accepted tip, with the line captured at the press. */
  onSent: (tip: SentTip) => void
}

/** Presses this close together, or this soon after a sheet closes, are one. */
const PRESS_GUARD_MS = 400
/** How long the receipt peek stays above the bar. */
const PEEK_MS = 6000

/**
 * When a sheet last closed (the shell's stack), for the press guard.
 * Temporary: the shell will stop a closing sheet from passing a press to
 * what is under it; this hook and its check in `press` go when it does.
 */
function useRecentSheetClose() {
  const at = useRef(0)
  useEffect(() => {
    let open = sheetStack.get().filter((entry) => entry.open).length
    return sheetStack.subscribe(() => {
      const now = sheetStack.get().filter((entry) => entry.open).length
      if (now < open) at.current = Date.now()
      open = now
    })
  }, [])
  return at
}

/**
 * How long "Sent $1" stays before the bar returns to idle (the design's
 * `--qt-dur-sent`). Read it from the system's token when the system has
 * one; when the money layer's controller owns the tip moment, this reset
 * moves there.
 */
const SENT_HOLD_MS = 1600

/** A few words for a reader who cannot tip here from the balance. */
const UNAVAILABLE_WORDS: Partial<Record<UnavailableReason, string>> = {
  closing: 'Your balance is closing',
  device: 'Set up this device to tip',
  'not-tippable': 'Tips are not on for this article',
  'settlement-off': 'Tipping is paused',
  'not-loaded': 'Tipping is not available now',
  absent: 'Tipping is not available now',
}

/** The sign-in page for a reader with no sign-in sheet (and no script). */
export function signInHref(returnTo: string) {
  return `/login?next=${encodeURIComponent(returnTo)}`
}

/** The Pocket's add-money sheet (`ADD_MONEY_SHEET`), with the tip it is
 * for; the balance until the Pocket has registered it. */
function openAddMoney(need: Money | null) {
  // Registered or declared lazily (shell/sheets/pocket.ts): either opens.
  if (sheetFor('add-money') || declaredSheet('add-money'))
    sheetStack.open('add-money', need ? { need } : {})
  else sheetStack.open('pocket')
}

/**
 * The tip bar under the article: the balance as a caption, the system's
 * tip control ("Tip $1", or "Tip this line $1" while a line is chosen) with
 * its visible amount choice, and Keep for a chosen line. Amounts, limits
 * and sending come from the money layer (`useTip`); this bar formats and
 * adds nothing. A tip does nothing else: it never keeps, follows or
 * shares, and never names the reader.
 */
export function TipBar({
  article,
  passage,
  onClear,
  kept,
  keepPending,
  onKeepChange,
  onLockChange,
  onSent,
}: TipBarProps) {
  const balance = useBalanceReading()
  const target = useMemo<TipTarget>(
    () =>
      passage
        ? {
            kind: 'passage',
            articleId: article.id,
            passage: {
              text: passage.text,
              startOffset: passage.startOffset,
              endOffset: passage.endOffset,
              startContainerPath: passage.startContainerPath,
              endContainerPath: passage.endContainerPath,
            },
          }
        : { kind: 'article', articleId: article.id },
    [article.id, passage]
  )
  const meta = useMemo<TipMeta>(
    () => ({
      articleTitle: article.title,
      writerName: article.writer.name,
      href: article.href,
    }),
    [article.title, article.writer.name, article.href]
  )
  const tip = useTip(target, meta)
  const state = tip.state

  // While a tip is held, queued or sending, the line cannot change: the
  // press captured it, and the mark and the receipt use that capture.
  const busy = state.phase === 'sending' || state.phase === 'sent' || tip.queued
  useEffect(() => onLockChange(busy), [busy, onLockChange])

  const pressed = useRef<{ passage: ChosenPassage | null; at: number } | null>(
    null
  )
  const lastSheetClose = useRecentSheetClose()
  const press = () => {
    const now = Date.now()
    // A double press, or the second tap of a double tap that closed a sheet
    // above the bar (its button sat over this one), is not a tip.
    if (pressed.current && now - pressed.current.at < PRESS_GUARD_MS) return
    if (now - lastSheetClose.current < PRESS_GUARD_MS) return
    pressed.current = { passage, at: now }
    void tip.tip()
  }

  // Report each accepted tip once, with the line captured at the press.
  const reported = useRef<string | null>(null)
  const [peek, setPeek] = useState<ReceiptProps | null>(null)
  useEffect(() => {
    if (state.phase !== 'sent' || reported.current === state.requestId) return
    reported.current = state.requestId
    const line = pressed.current?.passage ?? null
    onSent({ requestId: state.requestId, amount: state.amount, passage: line })
    // The receipt's code loads now, so it is there by the press.
    void preloadSheet(RECEIPT_SHEET)?.catch(() => {})
    setPeek({
      amount: state.amount,
      writerName: article.writer.name,
      articleTitle: article.title,
      line: line?.text ?? null,
    })
    const reset = setTimeout(() => tip.reset(), SENT_HOLD_MS)
    return () => clearTimeout(reset)
    // One report per request id; the callbacks are stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])
  useEffect(() => {
    if (!peek) return
    const hide = setTimeout(() => setPeek(null), PEEK_MS)
    return () => clearTimeout(hide)
  }, [peek])

  const signedOut =
    balance.auth === 'signed-out' || tip.unavailable === 'signed-out'
  // A signed-out visitor sees the default amount from public data.
  const offer = tip.signedOut
  const intent = {
    kind: 'tip' as const,
    articleId: article.id,
    href: article.href,
    // A ceiling, not an order: on return the money layer checks it
    // against the reader's own ladder and never raises it, and signing in sends nothing.
    amount: offer?.amount ?? null,
    passage: passage
      ? {
          text: passage.text,
          startOffset: passage.startOffset,
          endOffset: passage.endOffset,
        }
      : null,
  }

  let control: React.ReactNode
  if (tip.unavailable === 'own-article') {
    control = null
  } else if (signedOut) {
    control = (
      <a
        className="qt-read__signin"
        href={signInHref(article.href)}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) return
          if (openSignIn(intent)) event.preventDefault()
        }}
      >
        <span className="qt-read__signin-nib" aria-hidden="true">
          <Icon icon={TipIcon} size={20} />
        </span>
        <span className="qt-read__signin-words">
          {passage ? 'Tip this line' : `Tip ${article.writer.firstName}`}
        </span>
        {offer ? (
          <span className="qt-read__signin-amount">{offer.amount.display}</span>
        ) : null}
      </a>
    )
  } else if (tip.unavailable === 'no-balance') {
    control = (
      <Button
        variant="primary"
        icon={TipIcon}
        block
        onClick={() => openAddMoney(tip.amount)}
      >
        {tip.amount ? `Add money to tip ${tip.amount.display}` : 'Add money'}
      </Button>
    )
  } else {
    const loading = !tip.ready && !tip.warming
    const words = tip.unavailable
      ? (UNAVAILABLE_WORDS[tip.unavailable] ?? 'Tipping is not available now')
      : loading
        ? 'Tip'
        : null
    control = (
      <TipControl
        // No `hold` until the money layer's controller holds a tip: the
        // tip sends at once, as the balance tip does today.
        onNotNow={tip.reset}
        state={state}
        amount={tip.amount}
        amounts={tip.amounts}
        onAmountChange={tip.setAmount}
        onTip={press}
        onAddMoney={() => openAddMoney(tip.amount)}
        recipient={article.writer.name}
        recipientFirstName={article.writer.firstName}
        target={passage ? 'passage' : 'article'}
        onClearTarget={passage ? onClear : undefined}
        unavailable={words}
      />
    )
  }

  const showsMoney = !signedOut && balance.auth === 'signed-in'

  return (
    // The shell's dock: it reports its height, so toasts sit above the
    // bar and never cover a control the reader needs next.
    <Dock className="qt-read__dock">
      {/* A held Enter repeats keydown, and each repeat clicks the focused
          button: after "Sent", focus is back on Tip, so a held key would
          tip again. A repeat never activates anything in the bar. */}
      <div
        className="qt-read__dock-keys"
        onKeyDownCapture={(event) => {
          if (event.repeat && (event.key === 'Enter' || event.key === ' '))
            event.preventDefault()
        }}
      >
        {peek ? (
          // The receipt peek: a quiet row, not an announcement. The tip
          // control's own "Sent $1" (with focus) is the one announcement.
          <div className="qt-read__peek">
            <span className="qt-read__peek-tick" aria-hidden="true">
              <Icon icon={DoneIcon} size={16} />
            </span>
            <span className="qt-read__peek-words">
              {`You tipped ${article.writer.firstName}`}
            </span>
            <button
              type="button"
              className="qt-read__chip"
              onClick={() => sheetStack.open(RECEIPT_SHEET, peek)}
            >
              Receipt
            </button>
          </div>
        ) : null}
        {passage && !busy ? (
          <div className="qt-read__line-actions">
            <KeepButton
              kept={kept}
              pending={keepPending}
              showLabel
              onChange={(next) => {
                if (!signedOut) return onKeepChange(next)
                // Signed out: sign in first, carrying the line; nothing is
                // kept by signing in alone.
                if (!openSignIn({ ...intent, kind: 'keep' }))
                  window.location.assign(signInHref(article.href))
              }}
            />
          </div>
        ) : null}
        <div className="qt-read__dock-row">
          {showsMoney && !passage ? (
            <div className="qt-read__wallet">
              <MoneyFigure
                size="s"
                value={balance.available}
                status={balance.status}
                label="to tip"
                unavailableText="Balance"
              />
              <TestnetNote>Testnet</TestnetNote>
            </div>
          ) : null}
          <div className="qt-read__control">{control}</div>
        </div>
      </div>
    </Dock>
  )
}
