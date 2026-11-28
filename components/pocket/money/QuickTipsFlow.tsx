'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/system/components/Button'
import { Icon } from '@/system/components/Icon'
import { Spinner } from '@/system/components/Spinner'
import { DoneIcon } from '@/system/icons'
import { focusDestination } from '@/system/inputModality'
import { showToast } from '@/system/toast'
import { baseUnitsToCents, formatMoney } from '@/lib/payments/money'
import type { Money } from '@/lib/payments/types'
import { consentFigures } from '@/lib/addMoney/consent'
import { quickTipsOperation } from '@/lib/addMoney/operation'
import { failureView, type FailureView } from '@/lib/addMoney/failures'
import { quickTipsVariant, type QuickTipsVariant } from '@/lib/addMoney/plan'
import {
  StepError,
  type AddMoneyServices,
  type PreparedRequest,
  type StepFailure,
  type WalletConnection,
  type WalletRow,
} from '@/lib/addMoney/services'
import {
  NOTHING_SET_UP,
  QUICK_TIPS_DEFINITION,
  LEDGER_FINE_PRINT,
  TURN_OFF_LATER,
  feeRow,
  feeSpoken,
  fromRow,
  networkName,
  quickTipsSignsLine,
  quickTipsSigningLine,
  whyLine,
} from '@/lib/addMoney/words'
import { useSettlingPresses } from '@/hooks/addMoney/useSettlingPresses'
import { Rows } from './Rows'
import { WalletChoice } from './WalletChoice'

const SLOW_MS = 20_000
const STALE_MS = 120_000

type Step =
  | { at: 'checking' }
  | { at: 'review'; prepared: PreparedRequest; preparedAt: number }
  | { at: 'wallets'; pendingId: string | null }
  | { at: 'signing'; prepared: PreparedRequest }
  | { at: 'setting-up'; prepared: PreparedRequest; slow: boolean }
  | { at: 'done'; until: string }
  | { at: 'no-wallet' }
  | { at: 'problem'; view: FailureView }

/**
 * Set up or renew quick tips on this device: one wallet approval that
 * sends no money and does not send the tip. After it is confirmed the
 * reader is back on the line, and the tip is its own tap.
 */
export function QuickTipsFlow({
  services,
  tip,
  limitReached,
  close,
}: {
  services: AddMoneyServices
  /** The tip the reader wanted, when a tip opened the sheet. */
  tip: Money | null
  limitReached: boolean
  close: () => void
}) {
  const reading = services.useReading()
  const [step, setStep] = useState<Step>({ at: 'checking' })
  const [connection, setConnection] = useState<WalletConnection | null>(() =>
    services.connection()
  )
  const [variant, setVariant] = useState<QuickTipsVariant | null>(null)
  const cancelled = useRef(false)
  const made = useRef(false)
  const message = useRef<HTMLDivElement>(null)
  const settle = useSettlingPresses<HTMLDivElement>(step.at)
  const lastPrepared = useRef<PreparedRequest | null>(null)

  useEffect(() => {
    if (step.at !== 'checking') focusDestination(message.current)
    // Loaded while the review is read: the press opens the wallet at once.
    if (step.at === 'review') void services.warm()
  }, [step.at, services])
  useEffect(
    () => () => {
      cancelled.current = true
      if (made.current) void services.disconnect()
    },
    [services]
  )

  const choseNotTo = useCallback(() => {
    close()
    if (tip) showToast({ title: NOTHING_SET_UP })
  }, [close, tip])

  const fail = useCallback(
    (failure: StepFailure) => {
      if (cancelled.current) return
      if (failure.kind === 'cancelled') return choseNotTo()
      const view = failureView(failure, { balance: null, verb: 'approve' })
      if (view) setStep({ at: 'problem', view })
    },
    [choseNotTo]
  )
  const asFailure = (error: unknown): StepFailure =>
    error instanceof StepError
      ? error.failure
      : { kind: 'refused', message: 'Quilltip could not prepare this.' }

  const prepare = useCallback(() => {
    if (!reading?.address) return
    setStep({ at: 'checking' })
    services
      .prepare(quickTipsOperation(reading), reading.address)
      .then((prepared) => {
        if (cancelled.current) return
        lastPrepared.current = prepared
        setStep({ at: 'review', prepared, preparedAt: services.now() })
      })
      .catch((error) => fail(asFailure(error)))
  }, [reading, services, fail])

  // The variant is read once, when the sheet opens: why it opened.
  useEffect(() => {
    if (step.at !== 'checking' || !reading || variant) return
    if (!reading.address || reading.device === null) return
    setVariant(quickTipsVariant(reading.device, limitReached))
    prepare()
  }, [step.at, reading, variant, limitReached, prepare])

  // Confirmed when the server lists the new approval.
  useEffect(() => {
    if (step.at !== 'setting-up' || !reading) return
    const key = step.prepared.key!
    if (
      reading.keys.some((k) => k.publicKey?.toLowerCase() === key.publicKey)
    ) {
      if (reading.address)
        void services.retireOtherKeys(reading.address, key.publicKey)
      setStep({
        at: 'done',
        until: consentFigures(key, step.prepared.clock, reading.priceUsd).until,
      })
    }
  }, [step, reading, services])
  useEffect(() => {
    if (step.at !== 'setting-up' || step.slow) return
    const timer = setTimeout(
      () => setStep((s) => (s.at === 'setting-up' ? { ...s, slow: true } : s)),
      SLOW_MS
    )
    return () => clearTimeout(timer)
  }, [step])

  const sign = useCallback(
    (prepared: PreparedRequest) => {
      if (!reading?.address) return
      setStep({ at: 'signing', prepared })
      services
        .approve(prepared, reading.address)
        .then(async (signed) => {
          if (cancelled.current) return
          setStep({ at: 'setting-up', prepared, slow: false })
          const hash = await services.submit(signed, prepared)
          const result = await services.poll(
            hash,
            prepared.maxTime,
            new AbortController().signal
          )
          if (cancelled.current) return
          if (result === 'FAILED') fail({ kind: 'failed' })
          else if (result === 'TIMEOUT') fail({ kind: 'expired' })
        })
        .catch((error) => fail(asFailure(error)))
    },
    [reading, services, fail]
  )

  const onPrimary = () => {
    if (step.at !== 'review') return
    if (services.now() - step.preparedAt > STALE_MS) return prepare()
    const current = services.connection()
    if (!current || current.address !== reading?.address)
      return setStep({ at: 'wallets', pendingId: null })
    sign(step.prepared)
  }

  const choose = (row: WalletRow) => {
    setStep({ at: 'wallets', pendingId: row.id })
    services
      .connect(row.id)
      .then((c) => {
        if (cancelled.current) return
        made.current = true
        setConnection(c)
        if (reading?.address && c.address !== reading.address)
          return fail({
            kind: 'wrong-account',
            expected: reading.address,
            actual: c.address,
          })
        const prepared = lastPrepared.current
        if (prepared)
          setStep({ at: 'review', prepared, preparedAt: services.now() })
      })
      .catch((error) => {
        const failure = asFailure(error)
        if (failure.kind === 'cancelled')
          setStep({ at: 'wallets', pendingId: null })
        else fail(failure)
      })
  }

  const network = networkName()
  const price = reading?.priceUsd ?? null
  const label =
    variant === 'pending'
      ? 'Finish setting up quick tips'
      : variant === 'renew' || variant === 'limit'
        ? 'Renew quick tips'
        : 'Set up quick tips'
  let limitDollars: string | null = null
  if (variant === 'limit' && price && reading?.deviceKeyId != null) {
    const key = reading.keys.find((k) => k.keyId === reading.deviceKeyId)
    if (key?.acceptedTotal)
      limitDollars = formatMoney(
        baseUnitsToCents(BigInt(key.acceptedTotal), price),
        { converted: true }
      )
  }

  let body: ReactNode = null
  if (step.at === 'checking') {
    body = (
      <p className="qt-add__body qt-add__status" role="status">
        <Spinner /> Checking this device.
      </p>
    )
  } else if (step.at === 'review' && reading?.address) {
    const consent = consentFigures(
      step.prepared.key!,
      step.prepared.clock,
      price
    )
    const feeCents = price
      ? (Number(step.prepared.fee.stroops) / 1e7) * price * 100
      : null
    body = (
      <div className="qt-add__step">
        {variant ? (
          <p className="qt-add__body">{whyLine(variant, { limitDollars })}</p>
        ) : null}
        <p className="qt-add__body">{QUICK_TIPS_DEFINITION}</p>
        <p className="qt-add__consent">
          {quickTipsSignsLine(consent.until, consent.cap)}
        </p>
        <Rows
          rows={[
            {
              label: 'Wallet',
              value: fromRow(
                connection?.address === reading.address
                  ? connection.walletName
                  : null,
                reading.address
              ),
            },
            { label: 'Until', value: consent.until },
            { label: 'Up to', value: consent.cap },
            {
              label: 'Network fee',
              value: feeRow(
                step.prepared.fee.stroops,
                feeCents,
                step.prepared.fee.paidBy
              ),
              spoken: feeSpoken(
                step.prepared.fee.stroops,
                step.prepared.fee.paidBy
              ),
            },
          ]}
        />
        <p className="qt-add__fine">{LEDGER_FINE_PRINT}</p>
        <p className="qt-add__fine">{TURN_OFF_LATER}</p>
        <div className="qt-add__actions">
          <Button variant="primary" size="l" block onClick={onPrimary}>
            {label}
          </Button>
          <Button variant="quiet" block onClick={choseNotTo}>
            Not now
          </Button>
        </div>
      </div>
    )
  } else if (step.at === 'wallets') {
    body = (
      <WalletChoice
        title={`Approve with your ${network} wallet`}
        load={services.wallets}
        pendingId={step.pendingId}
        onChoose={choose}
        onNoWallet={() => setStep({ at: 'no-wallet' })}
      />
    )
  } else if (step.at === 'signing') {
    body = (
      <>
        <p className="qt-add__body" role="status">
          {quickTipsSigningLine(network)}
        </p>
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
  } else if (step.at === 'setting-up') {
    body = (
      <>
        <p className="qt-add__body qt-add__status" role="status">
          <Spinner />
          {step.slow
            ? ' Still checking. Stellar testnet is slow right now. You can close this; tipping turns on by itself when it is confirmed.'
            : ' Setting up. Waiting for Stellar testnet to confirm.'}
        </p>
        <Button variant="secondary" block onClick={close}>
          Close
        </Button>
      </>
    )
  } else if (step.at === 'done') {
    body = (
      <div className="qt-add__step">
        <p className="qt-add__done">
          <Icon icon={DoneIcon} size={20} /> Quick tips are on for this device
          until {step.until}.
        </p>
        <Button variant="primary" size="l" block onClick={close}>
          {tip ? 'Back to your tip' : 'Done'}
        </Button>
      </div>
    )
  } else if (step.at === 'no-wallet') {
    body = (
      <>
        <p className="qt-add__body">
          Quick tips on this phone need your wallet to approve this phone, here.
          Your balance is safe and shows on every device you sign in on. You can
          tip from the computer where your wallet is.
        </p>
        <Button variant="primary" size="l" block onClick={close}>
          {tip ? 'Keep reading' : 'Done'}
        </Button>
      </>
    )
  } else if (step.at === 'problem') {
    body = (
      <>
        <p className="qt-add__body">{step.view.body}</p>
        <Button
          variant="primary"
          size="l"
          block
          onClick={() => {
            if (
              step.view.action === 'connect-again' ||
              step.view.action === 'choose-another'
            ) {
              void services.disconnect()
              setConnection(null)
              setStep({ at: 'wallets', pendingId: null })
            } else prepare()
          }}
        >
          {step.view.action === 'connect-again'
            ? 'Connect again'
            : step.view.action === 'choose-another'
              ? 'Choose another wallet'
              : 'Try again'}
        </Button>
        <Button variant="quiet" block onClick={close}>
          Cancel
        </Button>
      </>
    )
  }

  return (
    <div className="qt-add" ref={settle} data-step={step.at}>
      <div ref={message} tabIndex={-1} className="qt-add__content">
        {body}
      </div>
    </div>
  )
}
