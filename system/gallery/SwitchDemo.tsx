'use client'

import { useCallback, useRef, useState } from 'react'
import { Switch } from '../components/Switch'
import { useSwitchSetting } from '../components/useSwitchSetting'

/**
 * A saved setting on sample data: the save takes 700 ms and fails when
 * "Fail the next save" is on, so the switch goes back and says why.
 */
export function SwitchDemo() {
  const [failNext, setFailNext] = useState(false)
  const fail = useRef(failNext)
  fail.current = failNext
  const save = useCallback(
    () =>
      new Promise<void>((resolve, reject) =>
        setTimeout(() => (fail.current ? reject(new Error()) : resolve()), 700)
      ),
    []
  )
  const name = useSwitchSetting(false, save)
  return (
    <div className="qt-gallery__stack" style={{ alignSelf: 'stretch' }}>
      <Switch
        label="Show my name on tips"
        description="Writers see your name instead of “A reader”."
        {...name.props}
      />
      <Switch
        label="Fail the next save"
        checked={failNext}
        onChange={setFailNext}
      />
    </div>
  )
}
