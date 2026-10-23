'use client'

import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { OpeningQuill, OpeningInkpot } from './OpeningInk'
import { visibleTimer } from './visibleTimer'

const clock = {
  now: () => performance.now(),
  set: (fn: () => void, ms: number) => window.setTimeout(fn, ms),
  clear: (id: number) => window.clearTimeout(id),
}
const settle = 'cubic-bezier(.22, 1, .36, 1)'

// Animate the real landing headline; no duplicate, remount, or layout substitution.
export function OpeningStage({ onFinish }: { onFinish: () => void }) {
  const backdrop = useRef<HTMLDivElement>(null)
  const readerMark = useRef<HTMLSpanElement>(null)
  const readerStroke = useRef<HTMLSpanElement>(null)
  const nib = useRef<HTMLSpanElement>(null)
  const inkpot = useRef<HTMLSpanElement>(null)
  const skip = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    const holdUntil = 4100
    const settlingDuration = 2100
    const duration = holdUntil + settlingDuration
    const at = (milliseconds: number) => milliseconds / duration
    const settling = (progress: number) =>
      at(holdUntil + settlingDuration * progress)
    const strikeStart = 730
    const strikeEnd = 1250
    const site = backdrop.current?.closest('.landing-blend')
    const heading = site?.querySelector<HTMLElement>('.value-headline')
    const line = heading?.querySelector<HTMLElement>('.value-line')
    const money = heading?.querySelector<HTMLElement>('del')
    const writing = heading?.querySelector<HTMLElement>('.replacement-word')
    if (
      !site ||
      !heading ||
      !line ||
      !money ||
      !writing ||
      !backdrop.current ||
      !inkpot.current ||
      !Element.prototype.animate
    ) {
      onFinish()
      return
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const skipButton = skip.current
    skipButton?.focus({ preventScroll: true })
    let cancelled = false
    let started = false
    let frame = 0
    let cancelFallback = () => {}
    const all: Animation[] = []
    const animate = (
      element: Element,
      keyframes: Keyframe[],
      options: KeyframeAnimationOptions = {}
    ) => {
      const animation = element.animate(keyframes, {
        duration,
        fill: 'both',
        ...options,
      })
      animation.pause()
      all.push(animation)
      return animation
    }
    const ink = getComputedStyle(heading).color
    const moneyInk = getComputedStyle(money).color
    const writingInk = getComputedStyle(writing).color
    const introInk = '#fff9f2'
    const correctionInk = '#f3bdd5'
    const headlineColor = (color: string) => [
      { color: introInk, offset: 0 },
      { color: introInk, offset: settling(0) },
      { color, offset: settling(6 / 13) },
      { color, offset: 1 },
    ]
    const range = document.createRange()
    range.selectNodeContents(line)
    const placement = () => {
      const r = range.getBoundingClientRect(),
        h = heading.getBoundingClientRect()
      const scale = Math.min(
        (innerWidth * 0.88) / r.width,
        (innerHeight * 0.5) / r.height,
        2.4
      )
      const dx = innerWidth / 2 - (r.x + r.width / 2)
      const dy = innerHeight * 0.47 - (r.y + r.height / 2)
      heading.style.transformOrigin = `${r.x + r.width / 2 - h.x}px ${r.y + r.height / 2 - h.y}px`
      return `translate(${dx}px, ${dy}px) scale(${scale})`
    }
    const initial = placement()
    const travelFrames = (transform: string) => [
      { transform, offset: 0 },
      { transform, offset: settling(0), easing: settle },
      { transform: 'none', offset: 1 },
    ]
    const travel = animate(heading, travelFrames(initial))
    animate(heading, headlineColor(ink))
    animate(money, headlineColor(moneyInk))
    const writingAnimation = animate(writing, [
      {
        opacity: 0,
        clipPath: 'inset(-30% 110% -30% -15%)',
        color: correctionInk,
        offset: 0,
      },
      {
        opacity: 0,
        clipPath: 'inset(-30% 110% -30% -15%)',
        color: correctionInk,
        offset: at(825),
      },
      {
        opacity: 1,
        clipPath: 'inset(-30% -15% -30% -15%)',
        color: correctionInk,
        offset: at(1452),
      },
      {
        opacity: 1,
        clipPath: 'inset(-30% -15% -30% -15%)',
        color: correctionInk,
        offset: settling(0),
      },
      {
        opacity: 1,
        clipPath: 'inset(-30% -15% -30% -15%)',
        color: writingInk,
        offset: settling(6 / 13),
      },
      {
        opacity: 1,
        clipPath: 'inset(-30% -15% -30% -15%)',
        color: writingInk,
        offset: 1,
      },
    ])
    // Animate a real stroke over the existing pseudo-element, which is held hidden.
    const stroke = document.createElement('span')
    stroke.setAttribute('aria-hidden', 'true')
    const pseudo = getComputedStyle(money, '::after')
    for (const property of [
      'position',
      'left',
      'right',
      'top',
      'height',
      'border-radius',
      'clip-path',
      'transform-origin',
    ])
      stroke.style.setProperty(property, pseudo.getPropertyValue(property))
    money.append(stroke)
    const strokeAnimation = animate(stroke, [
      {
        transform: 'scaleX(0) rotate(-3deg)',
        backgroundColor: correctionInk,
        offset: 0,
      },
      {
        transform: 'scaleX(0) rotate(-3deg)',
        backgroundColor: correctionInk,
        offset: at(strikeStart),
        easing: 'linear',
      },
      {
        transform: 'scaleX(1) rotate(-3deg)',
        backgroundColor: correctionInk,
        offset: at(strikeEnd),
      },
      {
        transform: 'scaleX(1) rotate(-3deg)',
        backgroundColor: correctionInk,
        offset: settling(0),
      },
      {
        transform: 'scaleX(1) rotate(-3deg)',
        backgroundColor: writingInk,
        offset: 1,
      },
    ])
    const nibAnimation = nib.current
      ? animate(nib.current, [{ opacity: 0 }, { opacity: 0 }])
      : null
    const placeNib = () => {
      if (!nibAnimation || !inkpot.current) return
      // Both ink and quill sample the same SVG path in screen coordinates. The
      // matrix includes the actual word rotation and enlarged headline scale.
      travel.currentTime = 0
      strokeAnimation.currentTime = strikeEnd
      const strokeRect = stroke.getBoundingClientRect()
      const thickness =
        (parseFloat(pseudo.height) * heading.getBoundingClientRect().width) /
        heading.offsetWidth
      const from = { x: strokeRect.left, y: strokeRect.bottom - thickness / 2 }
      const to = { x: strokeRect.right, y: strokeRect.top + thickness / 2 }
      const pot = {
        x: innerWidth * 0.86,
        y: range.getBoundingClientRect().bottom + 30,
      }
      inkpot.current.style.transform = `translate(${pot.x}px, ${pot.y}px)`
      const point = (x: number, y: number, angle = 0) =>
        `translate(${x}px, ${y}px) rotate(${angle}deg)`
      const angle = (x: number) => (x > innerWidth - 70 ? -68 : -8)
      const penFrames = [
        { opacity: 0, transform: point(pot.x, pot.y - 12), offset: 0 },
        { opacity: 1, transform: point(pot.x, pot.y - 12), offset: at(180) },
        { opacity: 1, transform: point(pot.x, pot.y + 4, 3), offset: at(360) },
        { opacity: 1, transform: point(pot.x, pot.y + 4, 3), offset: at(460) },
        {
          opacity: 1,
          transform: point(pot.x - 12, pot.y - 30, -10),
          offset: at(600),
        },
        {
          opacity: 1,
          transform: point(from.x, from.y, angle(to.x)),
          offset: at(strikeStart),
        },
        {
          opacity: 1,
          transform: point(to.x, to.y, angle(to.x)),
          offset: at(strikeEnd),
        },
        {
          opacity: 1,
          transform: point(to.x - 20, to.y - 32, angle(to.x)),
          offset: at(1370),
        },
      ]
      ;(writingAnimation.effect as KeyframeEffect).setKeyframes([
        { opacity: 1, clipPath: 'none', color: correctionInk, offset: 0 },
        {
          opacity: 1,
          clipPath: 'none',
          color: correctionInk,
          offset: settling(0),
        },
        {
          opacity: 1,
          clipPath: 'none',
          color: writingInk,
          offset: settling(6 / 13),
        },
        { opacity: 1, clipPath: 'none', color: writingInk, offset: 1 },
      ])
      const writingAngle = angle(writing.getBoundingClientRect().right)
      const paths = [
        ...writing.querySelectorAll<SVGPathElement>('[data-writing-stroke]'),
      ].sort(
        (a, b) =>
          Number(a.dataset.writingStroke) - Number(b.dataset.writingStroke)
      )
      const lengths = paths.map((path) => path.getTotalLength())
      const mainLength = lengths
        .slice(0, 7)
        .reduce((sum, length) => sum + length, 0)
      let time = 1510
      paths.forEach((path, index) => {
        const length = lengths[index]!
        // Connected letters take 1640ms, followed by deliberate pen lifts.
        const strokeDuration =
          index < 7 ? (1640 * length) / mainLength : index === 8 ? 100 : 45
        if (index >= 7) {
          const previous = penFrames.at(-1)!
          penFrames.push({
            ...previous,
            transform: previous.transform + ' translateY(-9px)',
            offset: at(time + 45),
          })
          time += 90
        }
        const start = time,
          end = start + strokeDuration
        animate(path, [
          {
            strokeDasharray: `${length} ${length}`,
            strokeDashoffset: length,
            opacity: 0,
            offset: 0,
          },
          {
            strokeDasharray: `${length} ${length}`,
            strokeDashoffset: length,
            opacity: 0,
            offset: at(start - 1),
          },
          {
            strokeDasharray: `${length} ${length}`,
            strokeDashoffset: length,
            opacity: 1,
            offset: at(start),
          },
          {
            strokeDasharray: `${length} ${length}`,
            strokeDashoffset: 0,
            opacity: 1,
            offset: at(end),
          },
          {
            strokeDasharray: `${length} ${length}`,
            strokeDashoffset: 0,
            opacity: 1,
            offset: 1,
          },
        ])
        const mask = path.closest('mask')
        const glyph =
          mask &&
          [...writing.querySelectorAll('text')].find(
            (text) => text.getAttribute('mask') === `url(#${mask.id})`
          )
        const matrix = (glyph || path).getScreenCTM()
        if (!matrix) return
        const steps = Math.max(2, Math.ceil(length / 2))
        for (let i = 0; i <= steps; i++) {
          const p = path
            .getPointAtLength((length * i) / steps)
            .matrixTransform(matrix)
          penFrames.push({
            opacity: 1,
            transform: point(p.x, p.y, writingAngle),
            offset: at(start + (strokeDuration * i) / steps),
          })
        }
        time = end
      })
      const last = penFrames.at(-1)!
      penFrames.push(
        {
          ...last,
          transform: last.transform + ' translateY(-20px)',
          offset: at(time + 120),
        },
        {
          opacity: 1,
          transform: point(pot.x, pot.y - 18, -4),
          offset: at(3900),
        },
        {
          opacity: 1,
          transform: point(pot.x, pot.y + 3, 0),
          offset: settling(0),
        },
        { opacity: 0, transform: point(pot.x, pot.y + 3, 0), offset: at(4380) },
        { opacity: 0, transform: point(pot.x, pot.y + 3, 0), offset: 1 }
      )
      ;(nibAnimation.effect as KeyframeEffect).setKeyframes(penFrames)
      animate(inkpot.current, [
        { opacity: 0, offset: 0 },
        { opacity: 1, offset: at(180) },
        { opacity: 1, offset: settling(0) },
        { opacity: 0, offset: at(4380) },
        { opacity: 0, offset: 1 },
      ])
    }
    animate(backdrop.current, [
      { opacity: 1, offset: 0 },
      { opacity: 1, offset: settling(0) },
      { opacity: 0, offset: settling(0.5) },
      { opacity: 0, offset: 1 },
    ])
    // A quiet preview of passage highlighting, within the existing headline hold.
    if (readerMark.current) {
      animate(readerMark.current, [
        { opacity: 0, transform: 'translateY(6px)', offset: 0 },
        {
          opacity: 0,
          transform: 'translateY(6px)',
          offset: at(3550),
          easing: settle,
        },
        {
          opacity: 1,
          transform: 'none',
          offset: at(3900),
        },
        { opacity: 1, transform: 'none', offset: settling(0) },
        { opacity: 0, transform: 'none', offset: at(holdUntil + 400) },
        { opacity: 0, transform: 'none', offset: 1 },
      ])
      animate(readerStroke.current!, [
        { transform: 'scaleX(0)', offset: 0 },
        {
          transform: 'scaleX(0)',
          offset: at(3720),
          easing: settle,
        },
        { transform: 'scaleX(1)', offset: at(4050) },
        { transform: 'scaleX(1)', offset: 1 },
      ])
    }
    site
      .querySelectorAll('.hero-copy > :not(h1), .sample-wallet-layout')
      .forEach((element, index) => {
        const start = settling((7 + Math.min(index, 3) * 3.5) / 52)
        animate(element, [
          { opacity: 0, transform: 'translateY(18px)', offset: 0 },
          {
            opacity: 0,
            transform: 'translateY(18px)',
            offset: start,
            easing: settle,
          },
          { opacity: 1, transform: 'none', offset: 1 },
        ])
      })
    const begin = () => {
      if (cancelled || started) return
      started = true
      // Re-measure after font loading, with the animated transform temporarily absent.
      travel.cancel()
      ;(travel.effect as KeyframeEffect).setKeyframes(travelFrames(placement()))
      placeNib()
      all.forEach((animation) => {
        animation.currentTime = 0
        if (!document.hidden) animation.play()
        else animation.pause()
      })
      travel.finished
        .then(() => {
          if (!cancelled) onFinish()
        })
        .catch(() => {})
      cancelFallback = visibleTimer(onFinish, duration + 3200, document, clock)
    }
    const cancelFontWait = visibleTimer(begin, 1000, document, clock)
    document.fonts.ready.then(() => {
      if (!cancelled) frame = requestAnimationFrame(begin)
    })
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onFinish()
    }
    // Scrolling advances into the same settling motion instead of deleting the stage.
    const advance = () => {
      if (!started) begin()
      all.forEach((animation) => {
        animation.currentTime = Math.max(
          Number(animation.currentTime) || 0,
          holdUntil
        )
      })
    }
    const visibilityChanged = () =>
      started &&
      all.forEach((animation) =>
        document.hidden ? animation.pause() : animation.play()
      )
    document.addEventListener('visibilitychange', visibilityChanged)
    addEventListener('keydown', escape)
    addEventListener('wheel', advance, { passive: true })
    addEventListener('touchmove', advance, { passive: true })
    addEventListener('resize', onFinish)
    return () => {
      const restoreFocus = document.activeElement === skipButton
      cancelled = true
      cancelAnimationFrame(frame)
      cancelFontWait()
      cancelFallback()
      all.forEach((animation) => animation.cancel())
      stroke.remove()
      if (restoreFocus)
        requestAnimationFrame(() => {
          if (heading.isConnected && !heading.closest('[inert]'))
            heading.focus({ preventScroll: true })
        })
      heading.style.removeProperty('transform-origin')
      document.body.style.overflow = previousOverflow
      document.removeEventListener('visibilitychange', visibilityChanged)
      removeEventListener('keydown', escape)
      removeEventListener('wheel', advance)
      removeEventListener('touchmove', advance)
      removeEventListener('resize', onFinish)
    }
  }, [onFinish])

  return (
    <>
      <div ref={backdrop} className="opening-stage" aria-hidden="true">
        <div className="opening-reader-position">
          <span ref={readerMark} className="opening-reader-mark">
            <span ref={readerStroke} className="opening-reader-stroke" />
            words we carry
          </span>
        </div>
      </div>
      {createPortal(
        <>
          <span ref={nib} className="opening-nib" aria-hidden="true">
            <OpeningQuill />
          </span>
          <span ref={inkpot} className="opening-inkpot" aria-hidden="true">
            <OpeningInkpot />
          </span>
          <button ref={skip} className="opening-skip" onClick={onFinish}>
            <span>Skip opening</span>
          </button>
        </>,
        document.body
      )}
    </>
  )
}
