'use client'

import { useLayoutEffect, useRef, useState } from 'react'

type Rect = { top: number; left: number; width: number; height: number }

/**
 * What a passage mark draws outside its text (design N5): the margin tick of
 * a chosen line or of your place, and the hold's band, one bar per wrapped
 * line, filled left to right in turn over the hold. It measures the mark's
 * line boxes against the reading column (`.qt-prose`, positioned) and
 * measures again when fonts arrive and when the column resizes. Drawn
 * behind the text; it never moves the text. Needs a script; the mark's own
 * fill and underline do not.
 */
export function LineOverlay({
  kind,
  restartKey,
}: {
  kind: 'chosen' | 'place' | 'holding'
  /** Restarts the band (the hold restarted). */
  restartKey?: number | string
}) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [rects, setRects] = useState<Rect[]>([])

  useLayoutEffect(() => {
    const marker = anchor.current
    const mark = marker?.previousElementSibling as HTMLElement | null
    const column = marker?.closest('.qt-prose') as HTMLElement | null
    if (!marker || !mark || !column) return
    const measure = () => {
      const base = column.getBoundingClientRect()
      setRects(
        Array.from(mark.getClientRects()).map((r) => ({
          top: r.top - base.top,
          left: r.left - base.left,
          width: r.width,
          height: r.height,
        }))
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(column)
    let alive = true
    void document.fonts?.ready.then(() => {
      if (alive) measure()
    })
    return () => {
      alive = false
      observer.disconnect()
    }
  }, [kind])

  const first = rects[0]
  const total = rects.reduce((sum, r) => sum + r.width, 0) || 1
  let before = 0
  return (
    <span ref={anchor} className="qt-line-overlay" aria-hidden="true">
      {kind !== 'holding' && first ? (
        <span
          className="qt-line-overlay__tick"
          data-kind={kind}
          style={{
            top: first.top,
            height: rects.at(-1)!.top + rects.at(-1)!.height - first.top,
          }}
        />
      ) : null}
      {kind === 'holding'
        ? rects.map((r, index) => {
            // Each line's share of the hold, in reading order.
            const share = r.width / total
            const delay = before / total
            before += r.width
            return (
              <span
                key={`${restartKey ?? 0}-${index}`}
                className="qt-line-overlay__band"
                style={{
                  top: r.top,
                  left: r.left,
                  width: r.width,
                  height: r.height,
                  ['--qt-band-share' as string]: share,
                  ['--qt-band-delay' as string]: delay,
                }}
              />
            )
          })
        : null}
    </span>
  )
}
