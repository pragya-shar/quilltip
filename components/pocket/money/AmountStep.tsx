'use client'

import { useState } from 'react'
import { Button } from '@/system/components/Button'
import { TextField } from '@/system/components/TextField'
import { formatMoney, formatTokenAmount } from '@/lib/payments/money'
import {
  checkOther,
  depositStroops,
  parseDollars,
  type AmountOffer,
} from '@/lib/addMoney/amounts'

type Offer = Extract<AmountOffer, { kind: 'amounts' }>

const short = (cents: number) => formatMoney(cents, { short: true })

/**
 * State 8: the amount. Segments inside the deposit range and what the
 * wallet can spend, then Other when the range has room beyond them; the
 * choice that covers the tip is selected. Nothing is asked of the wallet
 * here: "Review" prepares the request and shows its fee.
 */
export function AmountStep({
  offer,
  priceUsd,
  priceAt,
  lead,
  note,
  walletLine,
  onReview,
}: {
  offer: Offer
  priceUsd: number
  priceAt: string | null
  /** "You have ≈ $0.40 ready to tip." */
  lead: string
  /** One neutral line after a cancelled wallet step. */
  note: string | null
  /** When the wallet limits the amounts, what it can spend. */
  walletLine: string | null
  onReview: (cents: number) => void
}) {
  const [chosen, setChosen] = useState<number | 'other'>(
    offer.chosen ?? 'other'
  )
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lumens, setLumens] = useState(false)
  const typed = parseDollars(text)
  const cents = chosen === 'other' ? typed : chosen
  const problemWords = (problem: ReturnType<typeof checkOther>) =>
    problem === 'empty'
      ? 'Enter an amount in dollars.'
      : problem === 'below'
        ? `The smallest you can add is ${short(offer.minCents)}.`
        : problem === 'above'
          ? `Your balance can take ${formatMoney(offer.maxCents)} more.`
          : null
  const review = () => {
    if (chosen === 'other') {
      const problem = checkOther(typed, offer)
      if (problem) {
        setError(problemWords(problem))
        return
      }
    }
    if (cents !== null) onReview(cents)
  }
  return (
    <div className="qt-add__step">
      {note ? <p className="qt-add__note">{note}</p> : null}
      <p className="qt-add__body">{lead}</p>
      <div className="qt-add__amounts" role="radiogroup" aria-label="Amount">
        {offer.segments.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={chosen === c}
            className="qt-add__amount"
            onClick={() => {
              setChosen(c)
              setError(null)
            }}
          >
            {short(c)}
          </button>
        ))}
        {offer.other ? (
          <button
            type="button"
            role="radio"
            aria-checked={chosen === 'other'}
            className="qt-add__amount"
            onClick={() => setChosen('other')}
          >
            Other
          </button>
        ) : null}
      </div>
      {chosen === 'other' ? (
        <TextField
          label="Amount in dollars"
          prefix="$"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          value={text}
          error={error ?? undefined}
          onChange={(event) => {
            setText(event.target.value)
            if (error)
              setError(
                problemWords(
                  checkOther(parseDollars(event.target.value), offer)
                )
              )
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') review()
          }}
        />
      ) : null}
      <p className="qt-add__fine">
        You can add between {short(offer.minCents)} and{' '}
        {formatMoney(offer.maxCents)} right now.
      </p>
      {walletLine ? <p className="qt-add__fine">{walletLine}</p> : null}
      {lumens && cents !== null ? (
        <p className="qt-add__fine" role="status">
          {formatMoney(cents)} is{' '}
          {formatTokenAmount(depositStroops(cents, priceUsd))} at today’s price
          of {formatMoney(priceUsd * 100)} a Lumen. Your wallet shows it in
          Lumens.{priceAt ? ` Price at ${priceAt}.` : ''}
        </p>
      ) : null}
      <Button
        variant="quiet"
        aria-expanded={lumens}
        onClick={() => setLumens((open) => !open)}
      >
        {lumens ? 'Back to dollars' : 'In Lumens'}
      </Button>
      <Button
        variant="primary"
        size="l"
        block
        unavailable={cents === null && chosen !== 'other'}
        onClick={review}
      >
        {cents !== null ? `Review ${short(cents)}` : 'Review'}
      </Button>
    </div>
  )
}
