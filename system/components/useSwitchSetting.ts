'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A saved on/off setting for `Switch`. The switch moves at once (the person
 * sees their choice), shows pending while `save` runs, and on failure goes
 * back to the value it had and says why. A second press while saving is
 * ignored. When the stored value changes from elsewhere, it follows it.
 *
 *   const name = useSwitchSetting(user.showName, (on) =>
 *     updateProfile({ showName: on })
 *   )
 *   <Switch label="Show my name on tips" {...name.props} />
 */
export function useSwitchSetting(
  stored: boolean,
  save: (next: boolean) => Promise<unknown>,
  failure = 'That did not save. Try again.'
) {
  const [value, setValue] = useState(stored)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saving = useRef(false)
  useEffect(() => {
    if (!saving.current) setValue(stored)
  }, [stored])
  const onChange = useCallback(
    async (next: boolean) => {
      if (saving.current) return
      saving.current = true
      const before = value
      setValue(next)
      setError(null)
      setPending(true)
      try {
        await save(next)
      } catch {
        setValue(before)
        setError(failure)
      } finally {
        saving.current = false
        setPending(false)
      }
    },
    [failure, save, value]
  )
  return {
    props: { checked: value, onChange, pending, error },
  }
}
