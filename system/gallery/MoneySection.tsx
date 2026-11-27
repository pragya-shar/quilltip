'use client'

import { useState } from 'react'
import { MoneyFigure } from '../components/MoneyFigure'
import { TestnetNote } from '../components/TestnetNote'
import { TipControl } from '../components/TipControl'
import { GallerySection } from './GallerySection'
import { Specimen } from './Specimen'
import { amounts, money } from './samples'
import { useDemoTip } from './useDemoTip'

const noop = () => {}

/** The money figure and the tip control in every state. */
export function MoneySection() {
  const [refuse, setRefuse] = useState(false)
  const demo = useDemoTip(refuse)
  const held = useDemoTip(false, true)
  return (
    <GallerySection
      id="money"
      title="Money"
      note="Amounts are the money layer’s display strings. No placeholder zero: before an answer the figure holds space; when payments are down it says so."
    >
      <Specimen name="Balance, exact" wide>
        <MoneyFigure value={money.balance} size="xl" label="Ready to tip" />
        <TestnetNote />
      </Specimen>
      <Specimen name="Converted, approximate">
        <MoneyFigure value={money.approx} size="l" label="Ready to tip" />
      </Specimen>
      <Specimen name="Fractions of a cent, exact">
        <MoneyFigure value={money.fractional} size="l" label="Arrived" />
        <MoneyFigure value={money.share} size="s" tone="in" sign="+" />
      </Specimen>
      <Specimen name="A real zero">
        <MoneyFigure value={money.zero} size="l" label="Ready to tip" />
      </Specimen>
      <Specimen name="Loading">
        <MoneyFigure
          value={null}
          status="loading"
          size="xl"
          label="Ready to tip"
        />
      </Specimen>
      <Specimen name="Unavailable">
        <MoneyFigure
          value={null}
          status="unavailable"
          size="xl"
          label="Ready to tip"
        />
      </Specimen>
      <Specimen name="Large amount">
        <MoneyFigure value={money.large} size="m" />
      </Specimen>
      <Specimen name="Figure sizes" wide>
        <div className="qt-gallery__row" style={{ alignItems: 'flex-end' }}>
          <MoneyFigure value={money.balance} size="xl" label="xl, 52" />
          <MoneyFigure value={money.earnings} size="l" label="l, 44" />
          <MoneyFigure value={money.balance} size="m" label="m, 36" />
          <MoneyFigure
            value={{ cents: 3235, display: '$32.35' }}
            size="pending"
            label="pending, 26"
          />
          <MoneyFigure value={money.tipRow} size="s" label="s, 17" />
        </div>
      </Specimen>
      <Specimen name="Row sizes and tones">
        <div className="qt-gallery__stack">
          <MoneyFigure value={money.added} size="s" tone="in" sign="+" />
          <MoneyFigure value={money.tipRow} size="s" sign="−" />
          <MoneyFigure value={money.tipRow} size="s" tone="muted" />
          <MoneyFigure value={null} status="loading" size="s" />
          <MoneyFigure value={null} status="unavailable" size="s" />
        </div>
      </Specimen>

      <Specimen name="Tip control, live (sending, then sent)" wide>
        <div className="qt-gallery__tipbar">
          <label className="qt-gallery__toggle">
            <input
              type="checkbox"
              checked={refuse}
              onChange={(event) => setRefuse(event.target.checked)}
            />
            Refuse the next tip
          </label>
          <TipControl
            state={demo.state}
            amount={demo.amount}
            amounts={amounts}
            onAmountChange={demo.setCents}
            onTip={demo.tip}
            onNotNow={() => demo.setCents(demo.amount.cents)}
            recipient="Tomás Reyes"
          />
        </div>
      </Specimen>
      <Specimen name="Tip control with the hold, live (3 s, +$1, Cancel)" wide>
        <div className="qt-gallery__tipbar">
          <span className="qt-gallery__text">
            The money layer adds the hold; until then the tip sends at once.
          </span>
          <TipControl
            state={held.state}
            amount={held.amount}
            amounts={amounts}
            onAmountChange={held.setCents}
            onTip={held.tip}
            hold={held.hold}
            recipient="Ama Mensah"
          />
        </div>
      </Specimen>
      <Specimen name="Tip control, idle">
        <TipControl
          state={{ phase: 'idle' }}
          amount={money.one}
          amounts={amounts}
          onAmountChange={noop}
          onTip={noop}
          recipient="Tomás"
        />
      </Specimen>
      <Specimen name="Line targeted">
        <TipControl
          state={{ phase: 'idle' }}
          amount={money.three}
          amounts={amounts}
          onAmountChange={noop}
          onTip={noop}
          recipient="Tomás"
          target="passage"
          onClearTarget={noop}
        />
      </Specimen>
      <Specimen name="Holding">
        <TipControl
          state={{
            phase: 'other',
            words: 'Sending',
            amount: money.three,
            busy: true,
          }}
          amount={money.three}
          amounts={amounts}
          onAmountChange={noop}
          onTip={noop}
          recipient="Tomás Reyes"
          hold={{
            projected: '$18.40 → $15.40',
            onCancel: noop,
            onAddOne: noop,
            addOneBlocked: 'your daily limit is $5',
          }}
        />
      </Specimen>
      <Specimen name="A long name never cuts the amount">
        <TipControl
          state={{ phase: 'idle' }}
          amount={money.three}
          amounts={amounts}
          onAmountChange={noop}
          onTip={noop}
          recipient="Maximiliana-Alexandrina Featherstonehaugh"
        />
      </Specimen>
      <Specimen name="Sending">
        <TipControl
          state={{ phase: 'sending', amount: money.three }}
          amount={money.three}
          amounts={amounts}
          onAmountChange={noop}
          onTip={noop}
          recipient="Tomás"
        />
      </Specimen>
      <Specimen name="Sent">
        <TipControl
          state={{ phase: 'sent', amount: money.three }}
          amount={money.three}
          amounts={amounts}
          onAmountChange={noop}
          onTip={noop}
          recipient="Tomás"
        />
      </Specimen>
      <Specimen name="Refused">
        <TipControl
          state={{ phase: 'failed', amount: money.three }}
          amount={money.three}
          amounts={amounts}
          onAmountChange={noop}
          onTip={noop}
          recipient="Tomás"
        />
      </Specimen>
      <Specimen name="Needs money">
        <TipControl
          state={{
            phase: 'needs-funds',
            amount: money.three,
            available: { cents: 40, display: '$0.40' },
          }}
          amount={money.three}
          amounts={amounts}
          onAmountChange={noop}
          onTip={noop}
          onAddMoney={noop}
          recipient="Tomás"
        />
      </Specimen>
      <Specimen name="Another phase (slot for the design)">
        <TipControl
          state={{
            phase: 'other',
            words: 'Adding',
            amount: money.three,
            busy: true,
          }}
          amount={money.three}
          amounts={amounts}
          onAmountChange={noop}
          onTip={noop}
          recipient="Tomás"
        />
      </Specimen>
      <Specimen name="Offline">
        <TipControl
          state={{ phase: 'offline', amount: money.one }}
          amount={money.one}
          amounts={amounts}
          onAmountChange={noop}
          onTip={noop}
          recipient="Tomás"
        />
      </Specimen>
      <Specimen name="Unavailable">
        <TipControl
          state={{ phase: 'idle' }}
          amount={money.one}
          amounts={amounts}
          onAmountChange={noop}
          onTip={noop}
          recipient="Tomás"
          unavailable="Tipping paused"
        />
      </Specimen>
    </GallerySection>
  )
}
