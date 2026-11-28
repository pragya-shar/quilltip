import { useEffect, useState } from 'react'
import { useAuthPhase } from '../../../hooks/auth/useAuthPhase'
import { useResumedIntent } from '../../../hooks/auth/useResumedIntent'
import { amountWithin, tipIntent } from '../../../lib/auth/intent'
import { openSignIn } from '../../../shell/signIn'
import { SignOutButton } from './SignOutButton'

// Stands in for the Read surface's tip control: what any surface does with
// sign-in. Signed out, a press opens the sign-in sheet with the tip as its
// intent and sends nothing. After sign-in it takes its own intent back,
// shows the line chosen and an amount within the intent's ceiling, and
// waits: only a new press sends. `data-sends` counts every send.
const LINE = {
  text: 'She wrote down every coin she ever gave away.',
  startOffset: 0,
  endOffset: 45,
}
const CHOICES = [10, 25, 50, 100, 500]
const params = new URLSearchParams(location.search)
const ceiling = Number(params.get('ceiling') ?? 100)
const show = (cents: number) =>
  `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`

export function TipStandIn() {
  const phase = useAuthPhase()
  const [amount, setAmount] = useState(ceiling)
  const [chosen, setChosen] = useState(false)
  const [sends, setSends] = useState(0)
  const resumed = useResumedIntent('tip')
  useEffect(() => {
    if (!resumed) return
    setChosen(resumed.passage !== null)
    setAmount(amountWithin(resumed.amount.cents, CHOICES) ?? CHOICES[0]!)
  }, [resumed])
  return (
    <div className="qt-page" data-fixture="tip">
      <p data-line-chosen={chosen || undefined}>{LINE.text}</p>
      <button
        type="button"
        className="qt-button"
        data-variant="primary"
        data-fixture="tip-button"
        data-sends={sends}
        data-phase={phase}
        onClick={() => {
          if (phase === 'signed-in') {
            setSends((n) => n + 1)
            return
          }
          setChosen(true)
          openSignIn(
            tipIntent({
              path: location.pathname,
              articleId: 'a1b2c3',
              passage: LINE,
              amount: { cents: amount, display: show(amount) },
              writer: 'Theo Marsh',
            })
          )
        }}
      >
        <span className="qt-button__label">{`Tip this line ${show(amount)}`}</span>
      </button>
      <SignOutButton />
    </div>
  )
}
