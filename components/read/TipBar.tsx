'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Button } from '@/system/components/Button'
import { Icon } from '@/system/components/Icon'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { TestnetNote } from '@/system/components/TestnetNote'
import { TipControl } from '@/system/components/TipControl'
import { TipIcon } from '@/system/icons'
import { useBalanceReading } from '@/shell/balance'
import { sheetFor } from '@/shell/sheetRegistry'
import { sheetStack } from '@/shell/sheetStack'
import { openSignIn } from '@/shell/signIn'
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
  onKeep: () => void
  /** Once per accepted tip. */
  onSent: (tip: SentTip) => void
}

/** How long "Sent $1" stays before the bar is ready for the next tip. */
const SENT_HOLD_MS = 5000

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
  if (sheetFor('add-money')) sheetStack.open('add-money', need ? { need } : {})
  else sheetStack.open('pocket')
}

/**
 * The tip bar under the article: the balance as a caption, the system's
 * tip control ("Tip $1", or "Tip this line $1" while a line is chosen) with
 * its visible amount choice, and Keep for a chosen line. Amounts, limits
 * and sending come from the money layer (`useTip`); this bar formats and
 * adds nothing. A tip does nothing else (D4): it never keeps, follows or
 * shares.
 */
export function TipBar({
  article,
  passage,
  onClear,
  onKeep,
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

  // Report each accepted tip once, with the line it was for.
  const reported = useRef<string | null>(null)
  const sentFor = useRef<ChosenPassage | null>(null)
  useEffect(() => {
    if (state.phase === 'sending') sentFor.current = passage
  }, [state.phase, passage])
  useEffect(() => {
    if (state.phase !== 'sent' || reported.current === state.requestId) return
    reported.current = state.requestId
    onSent({
      requestId: state.requestId,
      amount: state.amount,
      passage: sentFor.current ?? passage,
    })
    const timer = setTimeout(() => tip.reset(), SENT_HOLD_MS)
    return () => clearTimeout(timer)
    // One report per request id; the callbacks are stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const signedOut =
    balance.auth === 'signed-out' || tip.unavailable === 'signed-out'
  const busy = state.phase === 'sending' || state.phase === 'sent'

  const intent = {
    kind: 'tip' as const,
    articleId: article.id,
    href: article.href,
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
        <span>
          {passage ? 'Tip this line' : `Tip ${article.writer.firstName}`}
        </span>
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
        Add money to tip
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
        state={state}
        amount={tip.amount}
        amounts={tip.amounts}
        onAmountChange={tip.setAmount}
        onTip={() => void tip.tip()}
        onAddMoney={() => openAddMoney(tip.amount)}
        recipient={article.writer.name}
        target={passage ? 'passage' : 'article'}
        onClearTarget={passage ? onClear : undefined}
        unavailable={words}
      />
    )
  }

  const showsMoney = !signedOut && balance.auth === 'signed-in'

  return (
    <div
      className="qt-read__dock"
      data-chosen={passage ? '' : undefined}
      data-phase={state.phase}
    >
      {passage && !busy ? (
        <div className="qt-read__line-actions">
          {signedOut ? (
            <a
              className="qt-read__chip"
              href={signInHref(article.href)}
              onClick={(event) => {
                if (openSignIn({ ...intent, kind: 'keep' }))
                  event.preventDefault()
              }}
            >
              Keep
            </a>
          ) : (
            <button type="button" className="qt-read__chip" onClick={onKeep}>
              Keep
            </button>
          )}
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
  )
}
