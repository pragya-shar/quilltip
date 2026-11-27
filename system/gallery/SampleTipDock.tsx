'use client'

import { TipControl } from '../components/TipControl'
import { amounts } from './samples'
import { useDemoTip } from './useDemoTip'

/**
 * The tip control docked under a reading page, on sample data. It is an
 * island beside the text: the article is complete without it.
 */
export function SampleTipDock() {
  const demo = useDemoTip(false)
  return (
    <div className="qt-sample__dock">
      <span className="qt-sample__count">132 tips</span>
      <TipControl
        state={demo.state}
        amount={demo.amount}
        amounts={amounts}
        onAmountChange={demo.setCents}
        onTip={demo.tip}
        recipient="Tomás Reyes"
      />
    </div>
  )
}
