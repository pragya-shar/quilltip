'use client'

import { useEffect } from 'react'
import { Dock } from '@/shell/Dock'
import { TipControl } from '../components/TipControl'
import { showToast } from '../toast'
import { amounts } from './samples'
import { useDemoTip } from './useDemoTip'

/**
 * The tip control docked under a reading page, on sample data. It is an
 * island beside the text: the article is complete without it.
 */
export function SampleTipDock() {
  const demo = useDemoTip(false)
  const sent = demo.state.phase === 'sent'
  useEffect(() => {
    if (sent)
      showToast({
        tone: 'done',
        title: 'You tipped Tomás $1',
        description: 'Supporter #89. Private to you.',
        action: { label: 'Receipt', onAction: () => {} },
      })
  }, [sent])
  return (
    <Dock className="qt-sample__dock">
      <span className="qt-sample__count">132 tips</span>
      <TipControl
        state={demo.state}
        amount={demo.amount}
        amounts={amounts}
        onAmountChange={demo.setCents}
        onTip={demo.tip}
        recipient="Tomás Reyes"
      />
    </Dock>
  )
}
