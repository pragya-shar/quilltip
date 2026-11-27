'use client'

import { useState } from 'react'
import { KeepButton } from '../components/KeepButton'

/** Keep on sample data: icon only and labelled, both toggle. */
export function KeepDemo() {
  const [kept, setKept] = useState(false)
  const [keptLabelled, setKeptLabelled] = useState(true)
  return (
    <div className="qt-gallery__row">
      <KeepButton kept={kept} onChange={setKept} />
      <KeepButton kept={keptLabelled} onChange={setKeptLabelled} showLabel />
      <KeepButton kept={false} onChange={() => {}} pending />
      <KeepButton kept={false} onChange={() => {}} disabled showLabel />
    </div>
  )
}
