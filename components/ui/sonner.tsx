'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Toaster as Sonner } from 'sonner'

type ToasterProps = React.ComponentProps<typeof Sonner>

/**
 * While set as the Toaster's id, it shows no toast (sonner 2.0.8; an upgrade
 * must pass scripts/ui/toaster-region.test.ts): sonner keeps every toast
 * it receives (and replays those raised before it subscribed) but lists only
 * the ones for this id, which no caller uses.
 */
export const HOLD_TOASTS_ID = 'quilltip-region-not-ready'

/** Frames the empty live region exists before the first toast goes in. */
export const REGION_READY_FRAMES = 2

/**
 * The site's toaster. It loads after the page (components/providers), so its
 * live region is created after hydration. A screen reader announces a change
 * inside a live region that already exists; a region created together with
 * its first message may not be announced (review of #503). So it holds every
 * toast until the empty region has existed for REGION_READY_FRAMES frames,
 * then shows them inside it.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()
  const [regionReady, setRegionReady] = useState(false)

  useEffect(() => {
    let frame = 0
    let left = REGION_READY_FRAMES
    const next = () => {
      left -= 1
      if (left <= 0) setRegionReady(true)
      else frame = requestAnimationFrame(next)
    }
    frame = requestAnimationFrame(next)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: 'group toast',
        },
      }}
      {...props}
      id={regionReady ? props.id : HOLD_TOASTS_ID}
    />
  )
}

export { Toaster }
