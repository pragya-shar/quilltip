'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { LandingNavigation } from '@/components/landing/LandingNavigation'
import { visibleTimer } from '@/components/landing/visibleTimer'

const title = 'The words we carry'
const passage =
  'There are words we read, and words we carry.\nA small permission to begin again.'

export function WriterIntroduction() {
  const [step, setStep] = useState(0)
  const [held, setHeld] = useState(false)
  const [reduced, setReduced] = useState(true)
  const [visible, setVisible] = useState(false)
  const [focused, setFocused] = useState(false)
  const [typed, setTyped] = useState(title.length + passage.length)
  const stage = useRef<HTMLDivElement>(null)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      { threshold: 0.3 }
    )
    if (stage.current) observer.observe(stage.current)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', update)
    }
  }, [])

  useEffect(() => {
    if (reduced || held || focused || !visible) return
    return visibleTimer(() => setStep((value) => 1 - value), 3000)
  }, [step, reduced, held, focused, visible])

  useEffect(() => {
    if (step !== 0 || reduced || held || !visible) return
    let cancel = () => {}
    let count = 0
    const tick = () => {
      setTyped(count++)
      if (count <= title.length + passage.length)
        cancel = visibleTimer(tick, 24)
    }
    tick()
    return () => cancel()
  }, [step, reduced, held, visible])

  function choose(next: number, focus = false) {
    setStep(next)
    setHeld(true)
    if (focus) tabs.current[next]?.focus()
  }

  const shown = reduced || held ? title.length + passage.length : typed

  return (
    <div className="landing-blend onboarding-study blend-study rose-study type-study presentation-view scene-study connected-study guided-sequence writer-introduction">
      <div className="colour-field" aria-hidden />
      <LandingNavigation />
      <main className="writer-intro-main">
        <Link className="writer-intro-back" href="/">
          Back to home
        </Link>
        <div className="writer-intro-spread">
          <section
            className="writer-intro-invitation"
            aria-labelledby="writer-intro-title"
          >
            <p className="writer-intro-eyebrow">For writers</p>
            <h1 id="writer-intro-title">
              A cozy home for your stories, thoughts, random anecdotes,
              feelings.<span>And the regards of your patrons.</span>
            </h1>
            <Link className="button primary" href="/write">
              Open writing desk <span aria-hidden>→</span>
            </Link>
          </section>
          <section
            className="writer-intro-demo"
            aria-label="Writing desk demonstration"
            onFocusCapture={() => setFocused(true)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                setFocused(false)
            }}
          >
            <div role="tablist" aria-label="Writing demonstration steps">
              {['Write', 'Publish'].map((label, index) => (
                <button
                  key={label}
                  id={`writer-tab-${index}`}
                  ref={(node) => {
                    tabs.current[index] = node
                  }}
                  role="tab"
                  aria-selected={step === index}
                  aria-controls="writer-demo-panel"
                  tabIndex={step === index ? 0 : -1}
                  onClick={() => choose(index)}
                  onKeyDown={(event) => {
                    if (
                      !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
                        event.key
                      )
                    )
                      return
                    event.preventDefault()
                    choose(
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? 1
                          : 1 - step,
                      true
                    )
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="writer-intro-disclaimer">
              A preview of your writing desk · nothing is published.
            </p>
            <div
              id="writer-demo-panel"
              role="tabpanel"
              aria-labelledby={`writer-tab-${step}`}
              ref={stage}
            >
              <p className="writer-intro-caption">
                {step === 0
                  ? 'A thought, ready to take shape.'
                  : 'Your words, as a reader sees them.'}
              </p>
              <article className="writer-intro-paper">
                <div className="writer-intro-paper-top">
                  <span>QuillTip</span>
                  <span>
                    {step === 0
                      ? 'Writing desk preview'
                      : 'Sample reader preview'}
                  </span>
                  <button onClick={() => choose(1 - step)}>
                    {step === 0 ? 'Preview ↗' : 'Back to draft'}
                  </button>
                </div>
                <div className="writer-intro-prose">
                  <div className="sr-only">
                    <h2>{title}</h2>
                    <p>{passage}</p>
                  </div>
                  <h2 aria-hidden>
                    {step === 0
                      ? title.slice(0, Math.min(title.length, shown))
                      : title}
                  </h2>
                  <p aria-hidden>
                    {step === 0
                      ? passage.slice(0, Math.max(0, shown - title.length))
                      : passage}
                  </p>
                  <em>
                    {step === 0
                      ? 'Ready for a reader’s view.'
                      : 'A page ready to read.'}
                  </em>
                </div>
                <div className="writer-intro-paper-bottom">
                  <span>Sample only</span>
                  <Link href="/write">Open writing desk</Link>
                </div>
              </article>
            </div>
            {!reduced && (
              <button
                className="writer-intro-motion"
                aria-pressed={held}
                onClick={() => {
                  if (held) setFocused(false)
                  setHeld((value) => !value)
                }}
              >
                {held ? 'Resume demonstration' : 'Pause demonstration'}
              </button>
            )}
          </section>
        </div>
        <div className="writer-intro-finish">
          <div>
            <h2>Your writing desk is ready.</h2>
            <p>Sign in to save drafts and begin your own story.</p>
          </div>
          <Link className="button primary" href="/write">
            Open writing desk <span aria-hidden>→</span>
          </Link>
        </div>
      </main>
    </div>
  )
}
