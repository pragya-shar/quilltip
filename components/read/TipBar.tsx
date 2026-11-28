'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/system/components/Button'
import { Icon } from '@/system/components/Icon'
import { KeepButton } from '@/system/components/KeepButton'
import { TipControl } from '@/system/components/TipControl'
import { DoneIcon, TipIcon } from '@/system/icons'
import { Dock } from '@/shell/Dock'
import { sheetFor } from '@/shell/sheetRegistry'
import { declaredSheet } from '@/shell/sheets'
import { sheetStack } from '@/shell/sheetStack'
import { openSignIn, signInHref } from '@/shell/signIn'
import { preloadSheet } from '@/shell/sheets/loadSheet'
import { useBalanceReading } from '@/shell/balance'
import { useEarlyPress } from '@/hooks/read/useEarlyPress'
// Types only: the money layer's code is in `LiveTip`, loaded after the page.
import type {
  Money,
  TipController,
  UnavailableReason,
} from '@/hooks/read/payments'
import { BalanceCaption } from './BalanceCaption'
import { RECEIPT_SHEET, type ReceiptProps } from './receipt'
import type { ChosenLine } from './LineEngine'
import type { LiveTipValue } from './LiveTip'
import type { ReadArticle } from './readModel'
import type { TipFirstPaint } from './tipFirstPaint'

/** The arrival after a first publish: loaded only when it is armed. */
const LiveArrivalSlot = dynamic(
  () => import('./LiveArrivalSlot').then((module) => module.LiveArrivalSlot),
  { ssr: false }
)

/** The sign-in intent builders and store: loaded on a signed-out press. */
const intents = () => import('./signInIntent')

/** The largest choice within the ceiling, or null: never raised. */
function amountWithin(ceiling: number, choices: readonly number[]) {
  let best: number | null = null
  for (const cents of choices)
    if (cents <= ceiling && (best === null || cents > best)) best = cents
  return best
}

/** What a tip that the server accepted was for. */
export type SentTip = {
  requestId: string
  amount: Money
  passage: ChosenLine | null
}

type TipBarProps = {
  article: ReadArticle
  /** What the server knows: the amount the button states first. */
  firstPaint: TipFirstPaint
  /** The money layer, once its code has loaded (`LiveTip`); else null. */
  live: LiveTipValue | null
  /** Its code did not load: the bar offers to try again. */
  liveFailed?: boolean
  onRetryLive?: () => void
  passage: ChosenLine | null
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
  /** The arrival after a first publish is armed (`liveArrival.ts`). */
  arrivalArmed?: boolean
  /** The arrival is over. */
  onArrivalDone?: () => void
  /** A resumed tip intent's ceiling, in cents, after sign-in. */
  resumeCeiling?: number | null
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
  'settlement-off': 'Tipping is paused',
  'not-loaded': 'Tipping is not available now',
  absent: 'Tipping is not available now',
}

/** Why no amount can be sent now, when a limit stops it. */
const BLOCKED_WORDS: Partial<
  Record<NonNullable<TipController['blocked']>, string>
> = {
  cap: 'Above your limit for one tip',
  daily: 'You have reached today’s tipping limit',
}

/** The words after a press that waited too long for the money layer. */
const MISSED_WORDS = 'Nothing sent. Tap to tip'

/**
 * The controller the bar draws before the money layer has loaded: the
 * server's amount, nothing to choose and nothing sent. A press is recorded
 * and handed to the real controller once it is ready (`useEarlyPress`).
 */
function firstPaintTip(firstPaint: TipFirstPaint): TipController {
  return {
    state: { phase: 'idle' },
    amount: firstPaint.amount,
    blocked: null,
    amounts: [firstPaint.amount],
    setAmount: () => {},
    tip: async () => {},
    reset: () => {},
    ready: false,
    warming: false,
    queued: false,
    unavailable: null,
    signedOut: null,
  }
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
 * The tip bar under the article: the balance as a button that opens it,
 * the system's tip control ("Tip $1", or "Tip this line $1" while a line
 * is chosen) with its visible amount choice, and Keep for a chosen line.
 * Amounts, limits and sending come from the money layer (`useTip`,
 * `useBalance`); this bar writes the button's amounts in the layer's short
 * form and adds nothing. A tip does nothing else: it never keeps, follows
 * or shares, and never names the reader.
 */
export function TipBar({
  article,
  firstPaint,
  live,
  liveFailed = false,
  onRetryLive = () => {},
  passage,
  onClear,
  kept,
  keepPending,
  onKeepChange,
  onLockChange,
  onSent,
  arrivalArmed = false,
  onArrivalDone = () => {},
  resumeCeiling = null,
}: TipBarProps) {
  // Until the money layer's code has loaded, the server's first paint.
  const firstTip = useMemo(() => firstPaintTip(firstPaint), [firstPaint])
  const tip = live?.tip ?? firstTip
  const balance = live?.balance ?? null
  // Before the layer loads the one amount is the server's, in short form.
  const short = live?.short ?? ((_amount: Money) => firstPaint.short)
  const state = tip.state
  // The shell's store knows the session and the balance before the layer
  // loads, so the balance row does not wait for it.
  const reading = useBalanceReading()
  const auth = reading.auth

  // A press before the controller is ready is recorded and shown as taken,
  // then handed to it once (`early.take`), or dropped (`useEarlyPress`).
  const early = useEarlyPress<ChosenLine | null>()
  // Set while a handed-over press waits for the controller's first phase,
  // so the bar does not flash idle between the two.
  const [handedOver, setHandedOver] = useState(false)
  useEffect(() => {
    if (handedOver && state.phase !== 'idle') setHandedOver(false)
  }, [handedOver, state.phase])
  useEffect(() => {
    if (!handedOver) return
    const stop = setTimeout(() => setHandedOver(false), 1000)
    return () => clearTimeout(stop)
  }, [handedOver])
  const taken = early.pending || handedOver

  // While a tip is taken, held, queued or sending, the line cannot change:
  // the press captured it, and the mark and the receipt use that capture.
  const busy =
    taken ||
    state.phase === 'holding' ||
    state.phase === 'sending' ||
    state.phase === 'sent' ||
    tip.queued
  useEffect(() => onLockChange(busy), [busy, onLockChange])

  const pressed = useRef<{ passage: ChosenLine | null; at: number } | null>(
    null
  )
  const lastSheetClose = useRecentSheetClose()
  /** Sends through the controller, for the line captured at the press. */
  const send = (line: ChosenLine | null) => {
    pressed.current = { passage: line, at: Date.now() }
    void tip.tip()
  }
  const press = () => {
    const now = Date.now()
    // A double press, or the second tap of a double tap that closed a sheet
    // above the bar (its button sat over this one), is not a tip.
    if (pressed.current && now - pressed.current.at < PRESS_GUARD_MS) return
    if (now - lastSheetClose.current < PRESS_GUARD_MS) return
    if (!live || !tip.ready) {
      // Taken now, sent once the controller is ready.
      if (early.record(passage)) pressed.current = { passage, at: now }
      return
    }
    early.clearMissed()
    send(passage)
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

  // A signed-out visitor sees the default amount from public data.
  const offer = tip.signedOut
  const signedOut =
    offer !== null ||
    tip.unavailable === 'signed-out' ||
    balance?.status === 'signed-out' ||
    auth === 'signed-out'
  // Where sign-in returns: the article, at the chosen line. A line is only
  // chosen in the browser, so this never differs from the server HTML.
  const returnTo = useMemo(
    () =>
      passage?.anchor ? `${article.href}#${passage.anchor}` : article.href,
    [article.href, passage]
  )
  // A signed-out reader may press: the intent code loads now, after the
  // page, so a press never waits for it.
  useEffect(() => {
    if (signedOut) void intents().catch(() => {})
  }, [signedOut])
  const linePassage = passage
    ? {
        text: passage.text,
        startOffset: passage.startOffset,
        endOffset: passage.endOffset,
      }
    : null
  /**
   * Opens sign-in with what the reader meant to do, built by the sign-in
   * contract's builders: over the page when a sheet is registered, else on
   * the sign-in page, with the intent kept for this tab.
   */
  const signInWith = (kind: 'tip' | 'keep', href: string) => {
    void intents().then(({ tipIntent, keepIntent, saveIntent }) => {
      const intent =
        kind === 'tip'
          ? tipIntent({
              path: article.href,
              articleId: article.id,
              passage: linePassage,
              // A ceiling, never an order: the public offer, or before the
              // money layer has loaded, the amount the server stated.
              amount: offer
                ? {
                    cents: offer.amount.cents,
                    display: offer.amount.display,
                    short: short(offer.amount).display,
                  }
                : {
                    cents: firstPaint.amount.cents,
                    display: firstPaint.amount.display,
                    short: firstPaint.short.display,
                  },
              writer: article.writer.name,
            })
          : linePassage
            ? keepIntent({
                path: article.href,
                articleId: article.id,
                passage: linePassage,
              })
            : null
      if (openSignIn(intent ?? undefined)) return
      if (intent) saveIntent(intent)
      window.location.assign(href)
    })
  }

  // After sign-in, once: the resumed tip's amount, within its ceiling.
  // Nothing is sent; the island chose the line.
  const ceilingSet = useRef(false)
  useEffect(() => {
    if (ceilingSet.current || resumeCeiling == null) return
    if (!tip.ready || signedOut || tip.amounts.length === 0) return
    ceilingSet.current = true
    const cents = amountWithin(
      resumeCeiling,
      tip.amounts.map((a) => a.cents)
    )
    if (cents !== null) tip.setAmount(cents)
    // Once, when the controller has its amounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeCeiling, tip.ready, signedOut, tip.amounts.length])

  // What a tip at the default would need, when the balance is short.
  const need = tip.amount ?? balance?.limits?.defaultTip ?? null

  let control: React.ReactNode | undefined
  // An article that cannot take a tip offers none, to anyone: known from
  // the server render, or from the money layer once it has loaded.
  const notTippable =
    article.tippable === false || tip.unavailable === 'not-tippable'
  if (tip.unavailable === 'own-article') {
    // In the bar's place, so the bar keeps its size.
    control = <p className="qt-read__dock-line">This is your article.</p>
  } else if (notTippable) {
    control = (
      <p className="qt-read__dock-line" role="status">
        Tips are not on for this article.
      </p>
    )
  }
  const signInLink = (
    <a
      className="qt-read__signin"
      href={signInHref(returnTo)}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return
        // With a script: the sheet, or the sign-in page with the intent
        // kept. Without one, the link itself goes to the sign-in page.
        event.preventDefault()
        signInWith('tip', event.currentTarget.href)
      }}
    >
      <span className="qt-read__signin-nib" aria-hidden="true">
        <Icon icon={TipIcon} size={20} />
      </span>
      <span className="qt-read__signin-words">
        {passage ? 'Tip this line' : `Tip ${article.writer.firstName}`}
      </span>
      {offer ? (
        <span className="qt-read__signin-amount">
          {short(offer.amount).display}
        </span>
      ) : null}
    </a>
  )
  // The words a taken press, or one that waited too long, shows in place.
  const label = passage ? 'Tip this line' : `Tip ${article.writer.firstName}`
  const shownAmount = tip.amount ? short(tip.amount) : firstPaint.short
  const shownState:
    | TipController['state']
    | { phase: 'other'; words: string; amount: Money; busy: boolean } = taken
    ? { phase: 'other', words: label, amount: shownAmount, busy: true }
    : early.missed && state.phase === 'idle'
      ? {
          phase: 'other',
          words: MISSED_WORDS,
          amount: shownAmount,
          busy: false,
        }
      : state
  if (control !== undefined) {
    // Settled above: the article's own state.
  } else if (signedOut) {
    control = signInLink
  } else if (liveFailed && !live) {
    // The money layer's code did not load: nothing can be sent until it
    // does, and a press taken before is dropped.
    control = (
      <p className="qt-read__dock-line qt-read__dock-retry">
        Tipping did not load.{' '}
        <button type="button" className="qt-read__chip" onClick={onRetryLive}>
          Try again
        </button>
      </p>
    )
  } else if (tip.unavailable === 'no-balance' || tip.blocked === 'balance') {
    // Not enough balance, before any press: a way forward, with the need.
    control = (
      <Button
        variant="primary"
        icon={TipIcon}
        block
        onClick={() => openAddMoney(need)}
      >
        {need ? `Add money to tip ${short(need).display}` : 'Add money'}
      </Button>
    )
  } else if (tip.blocked === 'price') {
    control = (
      <p className="qt-read__dock-line">
        Dollar amounts are not available right now, so tipping is paused.
      </p>
    )
  } else {
    // Before the controller is ready the control states the server's
    // amount and takes a press (shown as taken, sent once it is ready).
    const words = tip.unavailable
      ? (UNAVAILABLE_WORDS[tip.unavailable] ?? 'Tipping is not available now')
      : tip.blocked && BLOCKED_WORDS[tip.blocked]
        ? BLOCKED_WORDS[tip.blocked]
        : null
    const tipControl = (
      <TipControl
        // The hold is the controller's: its phase and controls pass
        // through. Until the money layer holds a tip, it sends at once.
        onNotNow={tip.reset}
        state={shownState}
        hold={state.phase === 'holding' ? (tip.hold ?? null) : null}
        amount={tip.amount ? short(tip.amount) : null}
        amounts={tip.amounts.map(short)}
        onAmountChange={tip.setAmount}
        onTip={press}
        onAddMoney={() => openAddMoney(need)}
        recipient={article.writer.name}
        recipientFirstName={article.writer.firstName}
        target={passage ? 'passage' : 'article'}
        onClearTarget={passage ? onClear : undefined}
        unavailable={words}
        // Before the layer has loaded there is one amount and no other.
        allowOther={live !== null}
      />
    )
    control =
      auth === 'loading' && !live ? (
        // Before the session is known: the sign-in link, or with a
        // session token in this browser the tip control (the shell's
        // pre-paint marker shows one; with no script, the link).
        <div className="qt-read__switch" data-session-switch="">
          <div className="qt-read__when" data-when="signed-out">
            {signInLink}
          </div>
          <div className="qt-read__when" data-when="held">
            {tipControl}
          </div>
        </div>
      ) : (
        tipControl
      )
  }

  // The press taken before the controller was ready, handed over once it
  // is: through the same path as a press now, if the bar would send one.
  const sendable =
    !signedOut &&
    !notTippable &&
    tip.unavailable === null &&
    tip.blocked === null &&
    tip.amount !== null &&
    state.phase === 'idle'
  useEffect(() => {
    if (!live || !tip.ready) return
    const recorded = early.take()
    if (!recorded) return
    // Not sendable now (no balance, signed out, paused): dropped, and the
    // bar shows why.
    if (!sendable) return
    setHandedOver(true)
    send(recorded.line)
    // Once per readiness; `send` reads the current controller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, tip.ready, sendable])
  // The money layer did not load: a taken press is dropped.
  useEffect(() => {
    if (liveFailed) early.drop()
    // `drop` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveFailed])

  const showsMoney =
    !signedOut && reading.auth === 'signed-in' && reading.status === 'ready'
  const available = reading.available

  return (
    // The shell's dock: it reports its height, so toasts sit above the
    // bar and never cover a control the reader needs next.
    <Dock className="qt-read__dock">
      {arrivalArmed ? (
        <LiveArrivalSlot
          article={article}
          armed={arrivalArmed}
          own={tip.unavailable === 'own-article'}
          onDone={onArrivalDone}
        />
      ) : null}
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
              signInWith('keep', signInHref(returnTo))
            }}
          />
          {showsMoney ? <BalanceCaption available={available} compact /> : null}
        </div>
      ) : null}
      {showsMoney && !passage ? (
        // The dock's first row: the balance, the way to the balance sheet.
        <BalanceCaption available={available} />
      ) : null}
      {/* data-live: the money layer has reported (tests read it). */}
      <div className="qt-read__dock-row" data-live={live ? '' : undefined}>
        <div className="qt-read__control" data-taken={taken || undefined}>
          {control}
        </div>
      </div>
    </Dock>
  )
}
