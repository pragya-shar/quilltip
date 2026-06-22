'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type UseStaleLoadingOptions = {
  timeoutMs?: number
}

export function useStaleLoading(
  isLoading: boolean,
  { timeoutMs = 10_000 }: UseStaleLoadingOptions = {}
) {
  const [isStale, setIsStale] = useState(false)
  const timeoutIdRef = useRef<number | null>(null)

  const reset = useCallback(() => {
    setIsStale(false)
  }, [])

  useEffect(() => {
    if (!isLoading) {
      if (timeoutIdRef.current !== null) {
        window.clearTimeout(timeoutIdRef.current)
        timeoutIdRef.current = null
      }
      setIsStale(false)
      return
    }

    if (isStale) return

    timeoutIdRef.current = window.setTimeout(() => {
      setIsStale(true)
    }, timeoutMs)

    return () => {
      if (timeoutIdRef.current !== null) {
        window.clearTimeout(timeoutIdRef.current)
        timeoutIdRef.current = null
      }
    }
  }, [isLoading, isStale, timeoutMs])

  return { isStale, reset }
}
