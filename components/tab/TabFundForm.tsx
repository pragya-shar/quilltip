'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { TestnetLabel } from '@/components/payments'
import { useTabServices } from '@/hooks/tab/TabServicesContext'
import { TAB_ACTIONS, TAB_FUND_FORM } from '@/lib/copy/tab'
import { formatXlm } from '@/lib/payments/format'
import {
  addUnits,
  checkDeposit,
  maxDeposit,
  parseXlm,
  xlm,
  type DepositProblem,
} from '@/lib/tab-ui/amounts'
import type { TabLimits, WalletFunds } from '@/lib/tab-ui/types'

const PRESETS = [5, 10, 20] as const

type TabFundFormProps = {
  mode: 'open' | 'top-up'
  /** The verified address whose wallet pays. */
  address: string
  /** Confirmed tab balance before this deposit. */
  tabBalance: string
  /** A deposit now cancels a pending withdrawal. */
  closing?: boolean
  onSubmit: (amount: string) => void
  onCancel: () => void
}

function problemText(problem: DepositProblem): string {
  const copy = TAB_FUND_FORM.errors
  switch (problem.kind) {
    case 'empty':
      return copy.empty
    case 'invalid':
      return copy.invalid
    case 'below-minimum':
      return copy.belowMinimum(formatXlm(problem.minimum))
    case 'above-cap':
      return copy.aboveCap(formatXlm(problem.room))
    case 'above-spendable':
      return copy.aboveSpendable(formatXlm(problem.spendable))
  }
}

/**
 * Open a tab or top it up. Before the wallet prompt it states the deposit
 * bounds from the Tab contract, what the wallet can spend after its
 * reserve, and the tab balance afterwards.
 */
export function TabFundForm({
  mode,
  address,
  tabBalance,
  closing = false,
  onSubmit,
  onCancel,
}: TabFundFormProps) {
  const services = useTabServices()
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('10')
  const [funds, setFunds] = useState<WalletFunds | null | undefined>(undefined)
  const [limits, setLimits] = useState<TabLimits | null | undefined>(undefined)
  const [shown, setShown] = useState<DepositProblem | null>(null)

  useEffect(() => {
    let alive = true
    void services
      .walletFunds(address)
      .then((f) => alive && setFunds(f))
      .catch(() => alive && setFunds(null))
    void services
      .tabLimits()
      .then((l) => alive && setLimits(l))
      .catch(() => alive && setLimits(null))
    return () => {
      alive = false
    }
  }, [services, address])

  useEffect(() => {
    // Focus the field when the form opens from a button, not on touch.
    if (!window.matchMedia('(pointer: coarse)').matches)
      inputRef.current?.focus()
  }, [])

  const amount = parseXlm(value)
  const problem = checkDeposit({
    amount,
    tabBalance,
    limits: limits ?? null,
    spendable: funds?.spendable ?? null,
  })
  // Validate late: show a problem once submitted, then follow the input.
  const visible = shown ? problem : null
  const max = maxDeposit({
    tabBalance,
    limits: limits ?? null,
    spendable: funds?.spendable ?? null,
  })
  const label = amount && amount !== '0' ? formatXlm(amount) : null
  const title =
    mode === 'open' ? TAB_FUND_FORM.openHeading : TAB_FUND_FORM.topUpHeading

  return (
    <form
      className="tab-form"
      aria-labelledby={`${id}-title`}
      noValidate
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
      onSubmit={(event) => {
        event.preventDefault()
        if (problem) {
          setShown(problem)
          inputRef.current?.focus()
          return
        }
        onSubmit(amount!)
      }}
    >
      <h3 id={`${id}-title`} className="tab-form-title">
        {title}
      </h3>
      <fieldset className="tab-presets">
        <legend>{TAB_FUND_FORM.presetsLabel}</legend>
        {PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            className="tab-preset"
            aria-pressed={amount === xlm(n)}
            onClick={() => {
              setValue(String(n))
              inputRef.current?.focus()
            }}
          >
            {n} XLM
          </button>
        ))}
      </fieldset>
      <div className="tab-field">
        <label htmlFor={`${id}-amount`}>{TAB_FUND_FORM.amountLabel}</label>
        <div className="tab-input-wrap">
          <input
            ref={inputRef}
            id={`${id}-amount`}
            type="text"
            inputMode="decimal"
            enterKeyHint="go"
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            value={value}
            aria-invalid={visible ? true : undefined}
            aria-describedby={`${id}-range${visible ? ` ${id}-error` : ''}`}
            onChange={(event) => setValue(event.target.value)}
          />
          <span className="tab-input-unit" aria-hidden="true">
            XLM
          </span>
        </div>
        <p id={`${id}-range`} className="tab-subtle">
          {limits
            ? max !== null
              ? TAB_FUND_FORM.range(
                  formatXlm(limits.minDeposit),
                  formatXlm(max)
                )
              : TAB_FUND_FORM.rangeMin(formatXlm(limits.minDeposit))
            : null}
        </p>
        {visible ? (
          <p id={`${id}-error`} className="tab-field-error">
            {problemText(visible)}
          </p>
        ) : null}
      </div>
      <div className="tab-statement" aria-live="polite">
        <p>
          {funds
            ? TAB_FUND_FORM.spendable(
                formatXlm(funds.spendable),
                formatXlm(funds.balance),
                formatXlm(funds.reserve)
              )
            : TAB_FUND_FORM.spendableUnknown}
        </p>
        {amount && !problem ? (
          <p>{TAB_FUND_FORM.after(formatXlm(addUnits(tabBalance, amount)))}</p>
        ) : null}
        {mode === 'open' ? <p>{TAB_FUND_FORM.keyNote}</p> : null}
        {closing ? <p>{TAB_FUND_FORM.cancelsWithdrawal}</p> : null}
        <TestnetLabel />
      </div>
      <div className="tab-actions">
        <button type="submit" className="tab-primary">
          {label
            ? mode === 'open'
              ? TAB_FUND_FORM.submitOpen(label)
              : TAB_FUND_FORM.submitTopUp(label)
            : mode === 'open'
              ? TAB_ACTIONS.open
              : TAB_ACTIONS.topUp}
        </button>
        <button type="button" className="tab-secondary" onClick={onCancel}>
          {TAB_ACTIONS.cancel}
        </button>
      </div>
    </form>
  )
}
