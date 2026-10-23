'use client'

import { useEffect, useRef } from 'react'
import { LiteraryObject } from './LiteraryObject'

type Box = { x: number; y: number; w: number; h: number }
type Placed = {
  x: number
  y: number
  kind: string
  band: number
  column: number
}

// Seeded placement from the prototype keeps stationery in gaps around the content.
function arrangeStationery(root: HTMLElement, items: SVGSVGElement[]) {
  const base = root.getBoundingClientRect()
  const width = base.width,
    height = root.scrollHeight,
    mobile = width < 600
  const placed: Placed[] = [],
    obstacles: Box[] = []
  root
    .querySelectorAll(
      '.hero-copy,.margin-note,.paper-note,h1,h2,h3,p,small,summary,button,a,input,textarea,nav,.reading-paper,.reading-room-card,.reading-room .toolbar,.reading-room-header,.reading-room-footer,.reading-room .writer-filter'
    )
    .forEach((element) => {
      if (!element.getClientRects().length) return
      let rects: DOMRect[]
      if (element.matches('h1,h2,h3,p,.eyebrow')) {
        const range = document.createRange()
        range.selectNodeContents(element)
        rects = [...range.getClientRects()]
      } else rects = [element.getBoundingClientRect()]
      const gap = element.matches('.hero-copy') ? 28 : 12
      rects.forEach((r) => {
        if (r.width && r.height)
          obstacles.push({
            x: r.left - base.left - gap,
            y: r.top - base.top - gap,
            w: r.width + gap * 2,
            h: r.height + gap * 2,
          })
      })
    })
  let seed = 791
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  items.forEach((element, index) => {
    element.style.visibility = 'hidden'
    const size = parseFloat(getComputedStyle(element).width),
      kind = element.dataset.kind ?? String(index % 12)
    let best: Placed | null = null,
      score = -Infinity
    for (let n = 0; n < 650; n++) {
      const x = 12 + rand() * Math.max(1, width - size - 24),
        y = 155 + rand() * Math.max(1, height - size - 180)
      const box = {
        x: x - size * 0.22,
        y: y - size * 0.22,
        w: size * 1.44,
        h: size * 1.44,
      }
      if (
        obstacles.some(
          (r) =>
            box.x < r.x + r.w &&
            box.x + box.w > r.x &&
            box.y < r.y + r.h &&
            box.y + box.h > r.y
        )
      )
        continue
      const distance = placed.length
        ? Math.min(...placed.map((r) => Math.hypot(x - r.x, y - r.y)))
        : 200
      if (
        distance < (mobile ? 65 : 115) ||
        placed.some(
          (r) =>
            r.kind === kind &&
            Math.hypot(x - r.x, y - r.y) < (mobile ? 280 : 430)
        )
      )
        continue
      const band = Math.floor(y / (mobile ? 260 : 360)),
        column = Math.floor(x / (width / 3))
      const crowd =
        placed.filter((r) => r.band === band).length * 65 +
        placed.filter((r) => r.column === column && r.band === band).length *
          100
      const value = Math.min(distance, 420) - crowd + rand() * 35
      if (value > score) {
        score = value
        best = { x, y, kind, band, column }
      }
    }
    if (best) {
      element.style.left = best.x + 'px'
      element.style.top = best.y + 'px'
      element.style.visibility = 'visible'
      placed.push(best)
    }
  })
}

export function LandingOrnaments({
  rootSelector = '.landing-blend, .prototype-wallet',
  count = 36,
}: { rootSelector?: string; count?: number } = {}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = ref.current?.closest<HTMLElement>(rootSelector)
    if (!root) return
    let frame = 0,
      cancelled = false
    const arrange = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (cancelled || root.dataset.stageActive === 'true') return
        arrangeStationery(root, [
          ...root.querySelectorAll<SVGSVGElement>('.scatter-object'),
        ])
      })
    }
    const resize = new ResizeObserver(arrange)
    resize.observe(root)
    const opening = new MutationObserver(arrange)
    opening.observe(root, {
      attributes: true,
      attributeFilter: ['data-stage-active'],
    })
    document.fonts.ready.then(() => {
      if (!cancelled) arrange()
    })
    addEventListener('resize', arrange)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      resize.disconnect()
      opening.disconnect()
      removeEventListener('resize', arrange)
    }
  }, [rootSelector])
  return (
    <div ref={ref} className="literary-scatter" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => {
        const kind =
          index >= 28
            ? ([1, 2, 3, 5, 6, 7, 8, 11][index - 28] ?? 0)
            : index % 12
        return (
          <svg
            key={index}
            className="scatter-object"
            data-opening={index >= 28}
            data-kind={kind}
            viewBox="0 0 170 170"
          >
            <LiteraryObject kind={kind} />
          </svg>
        )
      })}
    </div>
  )
}
