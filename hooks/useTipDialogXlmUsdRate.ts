'use client'

import { useConvex } from 'convex/react'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/convex/_generated/api'
import {
  isDisplayCacheFresh,
  readDisplayCache,
  writeDisplayCache,
} from '@/lib/tipping/xlmRateDisplay'

export function useTipDialogXlmUsdRate(dialogOpen: boolean): {
  priceUsd: number | null
} {
  const convex = useConvex()
  const [priceUsd, setPriceUsd] = useState<number | null>(null)
  const fetchGenerationRef = useRef(0)

  useEffect(() => {
    if (!dialogOpen) return

    const generation = ++fetchGenerationRef.current
    const now = Date.now()
    const cached = readDisplayCache()
    if (cached && isDisplayCacheFresh(cached, now)) {
      setPriceUsd(cached.priceUsd)
      return
    }

    setPriceUsd(null)

    void (async () => {
      try {
        const result = await convex.query(api.xlmPrice.getCachedXlmPrice, {})
        if (fetchGenerationRef.current !== generation) return
        if (result === null) {
          setPriceUsd(null)
          return
        }
        const fetchedAt = Date.now()
        writeDisplayCache(result.priceUsd, fetchedAt)
        setPriceUsd(result.priceUsd)
      } catch {
        if (fetchGenerationRef.current !== generation) return
        setPriceUsd(null)
      }
    })()
  }, [dialogOpen, convex])

  return { priceUsd }
}
