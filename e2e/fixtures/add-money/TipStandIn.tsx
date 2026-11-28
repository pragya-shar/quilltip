import { useSyncExternalStore } from 'react'
import { sheetStack } from '../../../shell/sheetStack'
import { Button } from '../../../system/components/Button'
import { QuickTipsSection } from '../../../components/pocket/money/QuickTipsSection'
import { baseUnitsToCents, tipAmount } from '../../../lib/payments/money'
import { tipButtonWords } from '../../../lib/addMoney/plan'
import { readingNow, recordTip, subscribe } from './emulated'

const TIP = tipAmount(100)

/**
 * A stand-in for the money layer's tip button, by the rules of the tip
 * states: not enough balance first ("Add money to tip $1"), then the
 * device ("Set up to tip $1", "Renew to tip $1", "Finish setup to tip
 * $1", nothing while it is checked), then the tip. The line stays chosen
 * whatever the sheets do. A tip here is counted, never sent.
 */
export function TipStandIn({ place }: { place: 'article' | 'balance' }) {
  const reading = useSyncExternalStore(subscribe, readingNow)
  if (place === 'balance')
    return (
      <main className="qt-fixture-balance" style={{ padding: 16 }}>
        <h1>Balance</h1>
        <Button variant="primary" onClick={() => sheetStack.open('add-money')}>
          Add money
        </Button>
        <QuickTipsSection />
      </main>
    )
  const available =
    reading.priceUsd !== null
      ? baseUnitsToCents(BigInt(reading.available), reading.priceUsd)
      : 0
  const short = available < TIP.cents
  const words = reading.device ? tipButtonWords(reading.device) : null
  const checking = !short && reading.device === 'unchecked'
  const label = short
    ? `Add money to tip ${TIP.short}`
    : words
      ? `${words} ${TIP.short}`
      : `Tip this line ${TIP.short}`
  return (
    <main style={{ padding: 16, paddingBlockEnd: 160 }}>
      <h1>A sample article</h1>
      {Array.from({ length: 6 }, (_, i) => (
        <p
          key={i}
          data-chosen={i === 2 ? '' : undefined}
          style={i === 2 ? { background: 'var(--qt-marker-soft)' } : undefined}
        >
          {i === 2
            ? 'This is the chosen line, which stays chosen whatever the sheets do.'
            : 'Reading text that fills the page so the line sits in the middle of it.'}
        </p>
      ))}
      {/* Above the phone's navigation bar, as the tip bar sits. */}
      <div
        style={{
          position: 'fixed',
          insetInline: 16,
          insetBlockEnd: 'calc(var(--qt-nav-h, 64px) + 24px)',
          zIndex: 1,
        }}
      >
        {checking ? (
          <p data-fixture="dock-line">
            Checking this device with Stellar testnet. Tipping waits a moment.
          </p>
        ) : (
          <Button
            variant="primary"
            block
            data-fixture="tip"
            onClick={() => {
              if (short) sheetStack.open('add-money', { need: TIP })
              else if (words)
                sheetStack.open('quick-tips', {
                  tip: TIP,
                  verb: words === 'Renew to tip' ? 'renew' : 'set-up',
                })
              else recordTip()
            }}
          >
            {label}
          </Button>
        )}
      </div>
    </main>
  )
}
