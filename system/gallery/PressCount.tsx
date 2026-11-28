'use client'

import { useState } from 'react'
import { TipControl } from '../components/TipControl'
import { amounts, money } from './samples'

/** Counts what the control asks for, so a held key or a double press shows. */
export function PressCount() {
  const [count, setCount] = useState(0)
  return (
    <div className="qt-gallery__tipbar">
      <span className="qt-gallery__text" data-press-count={count}>
        Tips asked for: {count}
      </span>
      <TipControl
        state={{ phase: 'idle' }}
        amount={money.one}
        amounts={amounts}
        onAmountChange={() => {}}
        onTip={() => setCount((n) => n + 1)}
        recipient="Lena Park"
      />
    </div>
  )
}
