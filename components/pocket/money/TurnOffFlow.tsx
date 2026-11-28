'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/system/components/Button'
import { Icon } from '@/system/components/Icon'
import { Spinner } from '@/system/components/Spinner'
import { DoneIcon } from '@/system/icons'
import { focusDestination } from '@/system/inputModality'
import { formatTokenAmount } from '@/lib/payments/money'
import { failureView, type FailureView } from '@/lib/addMoney/failures'
import {
  StepError,
  type AddMoneyServices,
  type PreparedRequest,
  type StepFailure,
  type WalletConnection,
  type WalletRow,
} from '@/lib/addMoney/services'
import {
  QUICK_TIPS_FOOT,
  TURN_OFF_BODY,
  TURN_OFF_GAP,
  TURN_OFF_UNCONFIRMED,
  feeRow,
  fromRow,
  networkName,
  turnOffSigningLine,
} from '@/lib/addMoney/words'
import { useSettlingPresses } from '@/hooks/addMoney/useSettlingPresses'
import { Rows } from './Rows'
import { WalletChoice } from './WalletChoice'

type Step =
  | { at: 'checking' }
  | { at: 'review'; prepared: PreparedRequest; busy: boolean }
  /** Off in Quilltip; the wallet has not confirmed it yet. */
  | { at: 'unconfirmed'; prepared: PreparedRequest; note: string | null }
  | { at: 'wallets'; prepared: PreparedRequest; pendingId: string | null }
  | { at: 'signing'; prepared: PreparedRequest }
  | { at: 'confirming'; prepared: PreparedRequest }
  | { at: 'done' }
  | { at: 'problem'; view: FailureView }

/**
 * Turn off quick tips for one device. Quilltip stops accepting tips from
 * it at once, on the press; the wallet then records it on the network with
 * one approval that moves no money. A cancelled or failed wallet step does
 * not undo the first part, so this sheet never says "nothing changed".
 */
export function TurnOffFlow({
  services,
  keyId,
  close,
}: {
  services: AddMoneyServices
  keyId: number
  close: () => void
}) {
  const reading = services.useReading()
  const [step, setStep] = useState<Step>({ at: 'checking' })
  const [connection, setConnection] = useState<WalletConnection | null>(() =>
    services.connection()
  )
  const cancelled = useRef(false)
  const made = useRef(false)
  const message = useRef<HTMLDivElement>(null)
  const settle = useSettlingPresses<HTMLDivElement>(step.at)
  const address = reading?.address ?? null

  useEffect(() => {
    if (step.at !== 'checking') focusDestination(message.current)
  }, [step.at])
  useEffect(
    () => () => {
      cancelled.current = true
      if (made.current) void services.disconnect()
    },
    [services]
  )

  const asFailure = (error: unknown): StepFailure =>
    error instanceof StepError
      ? error.failure
      : { kind: 'refused', message: 'Quilltip could not prepare this.' }

  // The fee comes from the built request, before anything is asked.
  useEffect(() => {
    if (step.at !== 'checking' || !address) return
    let alive = true
    services
      .prepare({ kind: 'turn-off', keyId }, address)
      .then(
        (prepared) => alive && setStep({ at: 'review', prepared, busy: false })
      )
      .catch((error) => {
        if (!alive) return
        const view = failureView(asFailure(error), {
          balance: null,
          verb: 'approve',
        })
        if (view) setStep({ at: 'problem', view })
      })
    return () => {
      alive = false
    }
  }, [step.at, address, keyId, services])

  const confirm = (prepared: PreparedRequest) => {
    if (!address) return
    const current = services.connection()
    if (!current || current.address !== address) {
      setStep({ at: 'wallets', prepared, pendingId: null })
      return
    }
    setStep({ at: 'signing', prepared })
    services
      .sign(prepared, address)
      .then(async (signed) => {
        if (cancelled.current) return
        setStep({ at: 'confirming', prepared })
        const hash = await services.send(signed, prepared)
        const result = await services.poll(
          hash,
          prepared.maxTime,
          new AbortController().signal
        )
        if (cancelled.current) return
        if (result === 'SUCCESS') setStep({ at: 'done' })
        else setStep({ at: 'unconfirmed', prepared, note: null })
      })
      .catch((error) => {
        if (cancelled.current) return
        const failure = asFailure(error)
        const view =
          failure.kind === 'cancelled'
            ? null
            : failureView(failure, { balance: null, verb: 'approve' })
        setStep({ at: 'unconfirmed', prepared, note: view?.body ?? null })
      })
  }

  const turnOff = (prepared: PreparedRequest) => {
    if (step.at !== 'review' || step.busy) return
    if (!address || !reading) return
    setStep({ ...step, busy: true })
    // Turning this device off stops every live approval this browser
    // holds; another device's row stops that one only.
    const here = reading.keys.find((k) => k.keyId === keyId)?.here ?? false
    const ids = here
      ? [
          keyId,
          ...reading.keys
            .filter((k) => k.here && !k.revoked && k.keyId !== keyId)
            .map((k) => k.keyId),
        ]
      : [keyId]
    Promise.all(ids.map((id) => services.stopKey(id, address)))
      .then(() => {
        if (cancelled.current) return
        confirm(prepared)
      })
      .catch((error) => {
        const view = failureView(asFailure(error), {
          balance: null,
          verb: 'approve',
        })
        if (view) setStep({ at: 'problem', view })
      })
  }

  const choose = (row: WalletRow, prepared: PreparedRequest) => {
    setStep({ at: 'wallets', prepared, pendingId: row.id })
    services
      .connect(row.id)
      .then((c) => {
        if (cancelled.current) return
        made.current = true
        setConnection(c)
        if (address && c.address !== address) {
          const view = failureView(
            { kind: 'wrong-account', expected: address, actual: c.address },
            { balance: null, verb: 'approve' }
          )
          setStep({ at: 'unconfirmed', prepared, note: view?.body ?? null })
          return
        }
        setStep({ at: 'unconfirmed', prepared, note: null })
      })
      .catch(() => setStep({ at: 'unconfirmed', prepared, note: null }))
  }

  const network = networkName()
  const price = reading?.priceUsd ?? null
  const walletRow = (prepared: PreparedRequest) => [
    {
      label: 'Wallet',
      value: fromRow(
        connection?.address === address ? connection.walletName : null,
        address ?? ''
      ),
    },
    {
      label: 'Network fee',
      value: feeRow(
        prepared.feeStroops,
        price ? (Number(prepared.feeStroops) / 1e7) * price * 100 : null
      ),
      spoken: `${formatTokenAmount(prepared.feeStroops).replace('XLM', 'Lumens')}, paid by your wallet`,
    },
  ]

  let body: ReactNode = null
  if (step.at === 'checking' || step.at === 'confirming') {
    body = (
      <p className="qt-add__body qt-add__status" role="status">
        <Spinner />{' '}
        {step.at === 'checking'
          ? 'Checking.'
          : `Waiting for ${network} to confirm.`}
      </p>
    )
  } else if (step.at === 'review') {
    body = (
      <div className="qt-add__step">
        <p className="qt-add__body">{TURN_OFF_BODY}</p>
        <p className="qt-add__fine">{TURN_OFF_GAP}</p>
        <Rows rows={walletRow(step.prepared)} />
        <div className="qt-add__actions">
          <Button
            variant="primary"
            size="l"
            block
            loading={step.busy}
            onClick={() => turnOff(step.prepared)}
          >
            Turn off quick tips
          </Button>
          <Button variant="quiet" block disabled={step.busy} onClick={close}>
            Not now
          </Button>
        </div>
      </div>
    )
  } else if (step.at === 'unconfirmed') {
    body = (
      <div className="qt-add__step">
        <p className="qt-add__body">{TURN_OFF_UNCONFIRMED}</p>
        {step.note ? <p className="qt-add__fine">{step.note}</p> : null}
        <Rows rows={walletRow(step.prepared)} />
        <div className="qt-add__actions">
          <Button
            variant="primary"
            size="l"
            block
            onClick={() => confirm(step.prepared)}
          >
            Confirm in wallet
          </Button>
          <Button variant="quiet" block onClick={close}>
            Done
          </Button>
        </div>
      </div>
    )
  } else if (step.at === 'wallets') {
    const prepared = step.prepared
    body = (
      <WalletChoice
        title={`Confirm with your ${network} wallet`}
        load={services.wallets}
        pendingId={step.pendingId}
        onChoose={(row) => choose(row, prepared)}
        onNoWallet={() => setStep({ at: 'unconfirmed', prepared, note: null })}
      />
    )
  } else if (step.at === 'signing') {
    body = (
      <>
        <p className="qt-add__body" role="status">
          {turnOffSigningLine(network)}
        </p>
        <p className="qt-add__fine">Don’t see the request? Open your wallet.</p>
      </>
    )
  } else if (step.at === 'done') {
    body = (
      <div className="qt-add__step">
        <p className="qt-add__done">
          <Icon icon={DoneIcon} size={20} /> Quick tips are off for this device.
        </p>
        <Button variant="primary" size="l" block onClick={close}>
          Done
        </Button>
      </div>
    )
  } else if (step.at === 'problem') {
    body = (
      <>
        <p className="qt-add__body">{step.view.body}</p>
        <Button
          variant="primary"
          size="l"
          block
          onClick={() => setStep({ at: 'checking' })}
        >
          Try again
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
      <p className="qt-add__foot">{QUICK_TIPS_FOOT}</p>
    </div>
  )
}
