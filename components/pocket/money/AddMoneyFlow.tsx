'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/system/components/Button'
import { Icon } from '@/system/components/Icon'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { Spinner } from '@/system/components/Spinner'
import { DoneIcon } from '@/system/icons'
import { focusDestination } from '@/system/inputModality'
import { showToast } from '@/system/toast'
import {
  baseUnitsToCents,
  convertedMoney,
  formatMoney,
  formatTokenAmount,
} from '@/lib/payments/money'
import type { Money } from '@/lib/payments/types'
import {
  amountOffer,
  depositStroops,
  type AmountOffer,
} from '@/lib/addMoney/amounts'
import { consentFigures } from '@/lib/addMoney/consent'
import { failureView, type FailureView } from '@/lib/addMoney/failures'
import {
  addMoneyPlan,
  addQuickTipsAgainLabel,
  primaryLabel,
} from '@/lib/addMoney/plan'
import {
  StepError,
  type AddMoneyServices,
  type ChainFacts,
  type PreparedRequest,
  type StepFailure,
  type WalletConnection,
  type WalletRow,
} from '@/lib/addMoney/services'
import {
  NOTHING_ADDED,
  TESTNET_FOOT,
  feeRow,
  formatTime,
  fromRow,
  networkName,
  signingLine,
  smallestUnitLine,
} from '@/lib/addMoney/words'
import { useSettlingPresses } from '@/hooks/addMoney/useSettlingPresses'
import { AmountStep } from './AmountStep'
import { ReviewStep } from './ReviewStep'
import { WalletChoice } from './WalletChoice'

/** A review older than this is prepared again before the wallet is asked. */
const STALE_MS = 120_000
/** After this long, the adding state says the network is slow. */
const SLOW_MS = 20_000

type Request = {
  cents: number
  withQuickTips: boolean
}

type Step =
  | { at: 'checking' }
  | {
      at: 'stop'
      why:
        | 'price'
        | 'paused'
        | 'full'
        | 'wallet-short'
        | 'no-wallet'
        | 'unavailable'
    }
  | { at: 'wallets'; purpose: 'link' | 'sign'; pendingId: string | null }
  | { at: 'link'; connection: WalletConnection; busy: boolean }
  | { at: 'amount'; note: string | null }
  | { at: 'preparing'; request: Request }
  | {
      at: 'review'
      request: Request
      prepared: PreparedRequest
      preparedAt: number
      busy: boolean
    }
  | { at: 'signing'; request: Request; prepared: PreparedRequest }
  | {
      at: 'adding'
      request: Request
      prepared: PreparedRequest
      hash: string | null
      before: string
      polled: 'SUCCESS' | null
      slow: boolean
    }
  | { at: 'added'; request: Request; until: string | null }
  | { at: 'problem'; view: FailureView; request: Request | null }

/**
 * Add money, inside one sheet: amount, review with the fee, one wallet
 * approval, back to the tip. Every state changes in place. A top-up never
 * sends a tip. Cancelling in the wallet is the reader's choice: from a tip
 * the sheet closes over the same line with one neutral sentence; from the
 * balance it returns to the amount with that sentence.
 */
export function AddMoneyFlow({
  services,
  need,
  close,
}: {
  services: AddMoneyServices
  /** The tip the balance could not cover, when a tip opened the sheet. */
  need: Money | null
  close: () => void
}) {
  const reading = services.useReading()
  const entry = need ? 'tip' : 'balance'
  const [step, setStep] = useState<Step>({ at: 'checking' })
  const [facts, setFacts] = useState<ChainFacts | null>(null)
  const [linkedHere, setLinkedHere] = useState(false)
  const [connection, setConnection] = useState<WalletConnection | null>(() =>
    services.connection()
  )
  const madeConnection = useRef(false)
  const cancelled = useRef(false)
  const pollAbort = useRef<AbortController | null>(null)
  const message = useRef<HTMLDivElement>(null)
  const settle = useSettlingPresses<HTMLDivElement>(step.at)

  // Focus follows the state: its first line is read once.
  useEffect(() => {
    if (step.at !== 'checking') focusDestination(message.current)
  }, [step.at])

  // Leaving the sheet: no further step starts, the wallet is never asked
  // after it, and a connection this sheet made and did not use goes.
  useEffect(
    () => () => {
      cancelled.current = true
      pollAbort.current?.abort()
      if (madeConnection.current) void services.disconnect()
    },
    [services]
  )

  const leaveForTip = useCallback(
    (sentence: string | null) => {
      close()
      if (sentence) showToast({ title: sentence })
    },
    [close]
  )

  /** The reader's choice not to go on: never an error. */
  const choseNotTo = useCallback(() => {
    if (entry === 'tip') leaveForTip(NOTHING_ADDED)
    else setStep({ at: 'amount', note: NOTHING_ADDED })
  }, [entry, leaveForTip])

  const fail = useCallback(
    (failure: StepFailure, request: Request | null) => {
      if (cancelled.current) return
      if (failure.kind === 'cancelled') {
        choseNotTo()
        return
      }
      const balance = reading?.priceUsd
        ? formatMoney(
            baseUnitsToCents(BigInt(reading.available), reading.priceUsd),
            { converted: true }
          )
        : null
      const view = failureView(failure, { balance, verb: 'add' })
      if (view) setStep({ at: 'problem', view, request })
    },
    [choseNotTo, reading]
  )

  // Checking: the reading, then what the wallet and the contract allow.
  useEffect(() => {
    if (step.at !== 'checking' || reading === undefined) return
    if (!reading.userId) {
      setStep({ at: 'stop', why: 'unavailable' })
      return
    }
    if (!reading.address) {
      setStep({ at: 'wallets', purpose: 'link', pendingId: null })
      return
    }
    let alive = true
    services
      .facts(reading.address)
      .then((f) => {
        if (!alive) return
        setFacts(f)
        setStep({ at: 'amount', note: null })
      })
      .catch(() => alive && setStep({ at: 'stop', why: 'unavailable' }))
    return () => {
      alive = false
    }
  }, [step.at, reading, services])

  const offer: AmountOffer | null =
    reading && facts
      ? amountOffer({
          priceUsd: reading.priceUsd,
          balance: reading.confirmed,
          limits: facts.limits,
          spendable: facts.spendable,
          needCents: need?.cents ?? null,
        })
      : null

  const plan = addMoneyPlan({ entry, device: reading?.device ?? null })

  const prepare = useCallback(
    (request: Request) => {
      if (!reading?.address || !reading.priceUsd) return
      const amount = depositStroops(request.cents, reading.priceUsd)
      setStep({ at: 'preparing', request })
      services
        .prepare(
          {
            kind: 'add',
            amount,
            withQuickTips: request.withQuickTips,
            balanceAfter: (
              BigInt(reading.confirmed) + BigInt(amount)
            ).toString(),
          },
          reading.address
        )
        .then((prepared) => {
          if (cancelled.current) return
          setStep({
            at: 'review',
            request,
            prepared,
            preparedAt: services.now(),
            busy: false,
          })
        })
        .catch((error) =>
          fail(
            error instanceof StepError
              ? error.failure
              : {
                  kind: 'refused',
                  message: 'Quilltip could not prepare this.',
                },
            request
          )
        )
    },
    [reading, services, fail]
  )

  const sign = useCallback(
    (request: Request, prepared: PreparedRequest) => {
      if (!reading?.address) return
      const before = reading.confirmed
      setStep({ at: 'signing', request, prepared })
      services
        .sign(prepared, reading.address)
        .then(async (signed) => {
          if (cancelled.current) return
          setStep({
            at: 'adding',
            request,
            prepared,
            hash: null,
            before,
            polled: null,
            slow: false,
          })
          const hash = await services.send(signed, prepared)
          if (cancelled.current) return
          setStep((s) => (s.at === 'adding' ? { ...s, hash } : s))
          const abort = new AbortController()
          pollAbort.current = abort
          const result = await services.poll(
            hash,
            prepared.maxTime,
            abort.signal
          )
          if (cancelled.current || abort.signal.aborted) return
          if (result === 'FAILED') fail({ kind: 'failed' }, request)
          else if (result === 'TIMEOUT') fail({ kind: 'expired' }, request)
          else
            setStep((s) => (s.at === 'adding' ? { ...s, polled: result } : s))
        })
        .catch((error) =>
          fail(
            error instanceof StepError
              ? error.failure
              : {
                  kind: 'wallet-failed',
                  message: 'Your wallet reported a problem.',
                },
            request
          )
        )
    },
    [reading, services, fail]
  )

  // Adding: confirmed when the balance read back shows it (and the device
  // approval, when there is one).
  useEffect(() => {
    if (step.at !== 'adding' || !reading) return
    const target = BigInt(step.before) + BigInt(step.prepared.amount)
    const moved =
      BigInt(reading.confirmed) >= target ||
      (step.polled === 'SUCCESS' && reading.confirmed !== step.before)
    const keyIn =
      !step.prepared.key ||
      reading.keys.some(
        (k) => k.publicKey?.toLowerCase() === step.prepared.key!.publicKey
      )
    if (moved && keyIn) {
      pollAbort.current?.abort()
      if (step.prepared.key && reading.address)
        void services.retireOtherKeys(
          reading.address,
          step.prepared.key.publicKey
        )
      const until = step.prepared.key
        ? consentFigures(
            step.prepared.key,
            step.prepared.clock,
            reading.priceUsd
          ).until
        : null
      setStep({ at: 'added', request: step.request, until })
    }
  }, [step, reading, services])
  useEffect(() => {
    if (step.at !== 'adding' || step.slow) return
    const timer = setTimeout(
      () => setStep((s) => (s.at === 'adding' ? { ...s, slow: true } : s)),
      SLOW_MS
    )
    return () => clearTimeout(timer)
  }, [step])

  // The review to return to after a wallet is connected for it.
  const lastReview = useRef<Extract<Step, { at: 'review' }> | null>(null)
  if (step.at === 'review') lastReview.current = step
  const backToReview = useCallback(() => {
    const r = lastReview.current
    if (r) setStep({ ...r, busy: false })
    else setStep({ at: 'amount', note: null })
  }, [])

  const choose = useCallback(
    (row: WalletRow, purpose: 'link' | 'sign') => {
      setStep({ at: 'wallets', purpose, pendingId: row.id })
      services
        .connect(row.id)
        .then((c) => {
          if (cancelled.current) return
          madeConnection.current = true
          setConnection(c)
          if (purpose === 'link') {
            setStep({ at: 'link', connection: c, busy: false })
            return
          }
          if (reading?.address && c.address !== reading.address) {
            fail(
              {
                kind: 'wrong-account',
                expected: reading.address,
                actual: c.address,
              },
              null
            )
            return
          }
          // An extension answers in this page: the press that chose it
          // asks it to sign. A web wallet opens a window, which needs a
          // fresh press: back to the review with the wallet named.
          const review = lastReview.current
          if (row.access === 'installed' && review)
            sign(review.request, review.prepared)
          else backToReview()
        })
        .catch((error) => {
          const failure =
            error instanceof StepError
              ? error.failure
              : ({ kind: 'cancelled' } as const)
          if (failure.kind === 'cancelled')
            setStep({ at: 'wallets', purpose, pendingId: null })
          else fail(failure, null)
        })
    },
    [services, reading, fail, backToReview, sign]
  )

  const link = useCallback(() => {
    if (step.at !== 'link') return
    setStep({ ...step, busy: true })
    services
      .link()
      .then(() => {
        if (cancelled.current) return
        setLinkedHere(true)
        setStep({ at: 'checking' })
      })
      .catch((error) =>
        fail(
          error instanceof StepError
            ? error.failure
            : { kind: 'refused', message: 'Your wallet was not linked.' },
          null
        )
      )
  }, [step, services, fail])

  const onPrimary = useCallback(() => {
    if (step.at !== 'review' || step.busy) return
    if (services.now() - step.preparedAt > STALE_MS) {
      prepare(step.request)
      return
    }
    const current = services.connection()
    if (!current || current.address !== reading?.address) {
      setStep({ at: 'wallets', purpose: 'sign', pendingId: null })
      return
    }
    sign(step.request, step.prepared)
  }, [step, services, reading, prepare, sign])

  const retry = useCallback(() => {
    if (step.at !== 'problem') return
    switch (step.view.action) {
      case 'connect-again':
      case 'choose-another':
        void services.disconnect()
        setConnection(null)
        setStep({
          at: 'wallets',
          purpose: reading?.address ? 'sign' : 'link',
          pendingId: null,
        })
        return
      default:
        if (step.request) prepare(step.request)
        else setStep({ at: 'checking' })
    }
  }, [step, services, reading, prepare])

  // ---------------------------------------------------------------------
  const price = reading?.priceUsd ?? null
  const availableMoney =
    reading && price
      ? convertedMoney(baseUnitsToCents(BigInt(reading.available), price))
      : null
  const keepReading = (
    <Button variant="primary" size="l" block onClick={close}>
      {entry === 'tip' ? 'Keep reading' : 'Done'}
    </Button>
  )
  const network = networkName()
  const priceAt = reading?.priceAt ? formatTime(reading.priceAt) : null

  let body: ReactNode = null
  if (step.at === 'checking' || (step.at === 'amount' && !offer)) {
    body = (
      <p className="qt-add__body qt-add__status" role="status">
        <Spinner /> Checking your wallet.
      </p>
    )
  } else if (step.at === 'stop') {
    body = (
      <>
        <p className="qt-add__body">
          {step.why === 'unavailable'
            ? 'Adding money is not available right now. Your balance is safe.'
            : 'No wallet can be used on this page.'}
        </p>
        {keepReading}
      </>
    )
  } else if (step.at === 'wallets') {
    body = (
      <WalletChoice
        title={`Add from a ${network} wallet`}
        load={services.wallets}
        pendingId={step.pendingId}
        onChoose={(row) => choose(row, step.purpose)}
        onNoWallet={() => setStep({ at: 'stop', why: 'no-wallet' })}
      />
    )
  } else if (step.at === 'link') {
    body = (
      <div className="qt-add__step">
        <p className="qt-add__step-label">Step 1 of 2</p>
        <p className="qt-add__body">
          This confirms the wallet is yours. No money moves. Your wallet asks
          you to sign a short message that links{' '}
          <span className="qt-add__address">
            {fromRow(null, step.connection.address)}
          </span>{' '}
          to your Quilltip account.
        </p>
        <Button
          variant="primary"
          size="l"
          block
          loading={step.busy}
          onClick={link}
        >
          Confirm wallet
        </Button>
        <Button variant="quiet" block disabled={step.busy} onClick={choseNotTo}>
          Cancel
        </Button>
      </div>
    )
  } else if (step.at === 'amount' && offer) {
    if (offer.kind === 'price-unknown')
      body = (
        <>
          <p className="qt-add__body">
            Dollar amounts are not available right now, so tipping is paused.
          </p>
          {keepReading}
        </>
      )
    else if (reading && !reading.accepting)
      body = (
        <>
          <p className="qt-add__body">
            Adding money is paused on {network} right now. Your balance is safe.
          </p>
          {keepReading}
        </>
      )
    else if (offer.kind === 'full')
      body = (
        <>
          <p className="qt-add__body">
            Your balance is at its limit of{' '}
            {formatMoney(offer.maxBalanceCents, { converted: true })}, so it
            cannot take more right now.
          </p>
          {keepReading}
        </>
      )
    else if (offer.kind === 'wallet-short')
      body = (
        <>
          <p className="qt-add__body">
            Your wallet can spend{' '}
            {formatMoney(offer.spendableCents, { converted: true })} (
            {formatTokenAmount(offer.spendable)} after Stellar’s reserve). Add
            test XLM to your wallet, then try again.
          </p>
          <Button
            variant="quiet"
            block
            onClick={() => setStep({ at: 'checking' })}
          >
            Check again
          </Button>
          {keepReading}
        </>
      )
    else if (offer.kind === 'limits-unknown')
      body = (
        <>
          <p className="qt-add__body">
            Stellar testnet could not be read right now. Your balance is safe.
          </p>
          <Button
            variant="quiet"
            block
            onClick={() => setStep({ at: 'checking' })}
          >
            Check again
          </Button>
          {keepReading}
        </>
      )
    else if (price)
      body = (
        <AmountStep
          offer={offer}
          priceUsd={price}
          priceAt={priceAt}
          note={step.note}
          lead={
            availableMoney
              ? need
                ? `You have ${availableMoney.display}. Nothing is sent until you tap Tip again.`
                : `You have ${availableMoney.display} ready to tip.`
              : need
                ? 'Nothing is sent until you tap Tip again.'
                : ''
          }
          walletLine={
            offer.walletLimited && facts?.spendable
              ? `Your wallet can spend ${formatMoney(baseUnitsToCents(BigInt(facts.spendable), price), { converted: true })} right now.`
              : null
          }
          onReview={(cents) =>
            prepare({ cents, withQuickTips: plan.quickTipsByDefault })
          }
        />
      )
  } else if (step.at === 'preparing') {
    body = (
      <p className="qt-add__body qt-add__status" role="status">
        <Spinner /> Getting the request ready.
      </p>
    )
  } else if (step.at === 'review' && reading && price) {
    const { request, prepared } = step
    const after = convertedMoney(
      baseUnitsToCents(
        BigInt(reading.available) + BigInt(prepared.amount),
        price
      )
    )
    const consent = prepared.key
      ? consentFigures(prepared.key, prepared.clock, price)
      : null
    const feeCents = (Number(prepared.feeStroops) / 1e7) * price * 100
    body = (
      <ReviewStep
        title={`Add ${formatMoney(request.cents)} to your balance.`}
        stepLabel={linkedHere ? 'Step 2 of 2' : null}
        rows={[
          {
            label: 'From',
            value: fromRow(
              connection?.address === reading.address
                ? connection.walletName
                : null,
              reading.address!
            ),
          },
          {
            label: 'Network fee',
            value: feeRow(prepared.feeStroops, feeCents),
            spoken: `${formatTokenAmount(prepared.feeStroops).replace('XLM', 'Lumens')}, paid by your wallet`,
          },
          {
            label: 'Your balance after',
            value: after.display,
            spoken: after.spoken,
          },
        ]}
        choice={plan.choice}
        withQuickTips={request.withQuickTips}
        consent={consent}
        firstDeposit={reading.status === 'none'}
        cancelsWithdrawal={reading.status === 'closing'}
        primary={primaryLabel(
          formatMoney(request.cents, { short: true }),
          request.withQuickTips,
          plan.verb
        )}
        againLabel={addQuickTipsAgainLabel(plan.verb)}
        busy={step.busy}
        onPrimary={onPrimary}
        onChoice={(withQuickTips) => prepare({ ...request, withQuickTips })}
        onNotNow={() =>
          entry === 'tip' ? leaveForTip(NOTHING_ADDED) : close()
        }
      />
    )
  } else if (step.at === 'signing' && price) {
    const { request, prepared } = step
    const consent = prepared.key
      ? consentFigures(prepared.key, prepared.clock, price)
      : null
    body = (
      <>
        <p className="qt-add__body" role="status">
          {signingLine({
            xlm: formatTokenAmount(prepared.amount),
            dollars: formatMoney(request.cents),
            fee: formatTokenAmount(prepared.feeStroops),
            network,
            quickTips: request.withQuickTips ? consent : null,
          })}
        </p>
        <p className="qt-add__fine">{smallestUnitLine(prepared.amount)}</p>
        <p className="qt-add__fine">Don’t see the request? Open your wallet.</p>
        <Button
          variant="quiet"
          block
          onClick={() => {
            cancelled.current = true
            choseNotTo()
          }}
        >
          Cancel
        </Button>
      </>
    )
  } else if (step.at === 'adding') {
    body = (
      <>
        <p className="qt-add__body qt-add__status" role="status">
          <Spinner />
          {step.slow
            ? ' Still checking. Stellar testnet is slow right now. If it went through, your balance shows it, and it cannot be added twice.'
            : ` Adding ${formatMoney(step.request.cents)}. Waiting for Stellar testnet to confirm. You can close this; your balance updates by itself.`}
        </p>
        <Button variant="secondary" block onClick={close}>
          Close
        </Button>
      </>
    )
  } else if (step.at === 'added') {
    body = (
      <div className="qt-add__step">
        <p className="qt-add__done">
          <Icon icon={DoneIcon} size={20} /> Added{' '}
          {formatMoney(step.request.cents)}.
        </p>
        {availableMoney ? (
          <div className="qt-add__figure">
            <MoneyFigure value={availableMoney} size="m" />
            <span className="qt-add__fine">ready to tip</span>
          </div>
        ) : null}
        {step.until ? (
          <p className="qt-add__body">
            Quick tips are on for this device until {step.until}.
          </p>
        ) : null}
        <Button variant="primary" size="l" block onClick={close}>
          {entry === 'tip' ? 'Back to your tip' : 'Done'}
        </Button>
      </div>
    )
  } else if (step.at === 'problem') {
    const label = {
      'try-again': 'Try again',
      'connect-again': 'Connect again',
      'check-again': 'Check again',
      'choose-another': 'Choose another wallet',
    }[step.view.action]
    body = (
      <>
        <p className="qt-add__body">{step.view.body}</p>
        <Button variant="primary" size="l" block onClick={retry}>
          {label}
        </Button>
        <Button variant="quiet" block onClick={close}>
          Cancel
        </Button>
      </>
    )
  }
  if (step.at === 'stop' && step.why === 'no-wallet')
    body = (
      <>
        <p className="qt-add__body">
          You can add money on a computer with your wallet there. Your balance
          shows on every device you sign in on. To tip from this phone, your
          wallet approves this phone once, here.
        </p>
        {keepReading}
      </>
    )

  return (
    <div className="qt-add" ref={settle} data-step={step.at}>
      <div ref={message} tabIndex={-1} className="qt-add__content">
        {body}
      </div>
      <p className="qt-add__foot">{TESTNET_FOOT}</p>
    </div>
  )
}
