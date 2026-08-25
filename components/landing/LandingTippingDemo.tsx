'use client'

import { Zap } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { useEffect, useState, useCallback, useRef } from 'react'

const ARTICLE_TEXT = `Writers pour their hearts into stories that shape how we think — yet most see nothing in return. The quiet revolution of open knowledge deserves better. What if readers could reward the exact words that moved them?`

interface HighlightPhrase {
  text: string
  tip: string
}

const HIGHLIGHT_PHRASES: HighlightPhrase[] = [
  { text: 'Writers pour their hearts', tip: '+$0.25' },
  { text: 'stories that shape how we think', tip: '+$0.50' },
  { text: 'the quiet revolution of open knowledge', tip: '+$0.75' },
  { text: 'reward the exact words that moved them', tip: '+$1.00' },
]

type AnimationStep = 'idle' | 'selecting' | 'highlighted' | 'tipped'

type Segment =
  | { type: 'text'; content: string }
  | { type: 'phrase'; content: string; phraseIndex: number }

function buildSegments(text: string, phrases: HighlightPhrase[]): Segment[] {
  const ranges: { start: number; end: number; index: number }[] = []
  phrases.forEach((p, i) => {
    const start = text.indexOf(p.text)
    if (start === -1) return
    ranges.push({ start, end: start + p.text.length, index: i })
  })
  ranges.sort((a, b) => a.start - b.start)

  const segments: Segment[] = []
  let cursor = 0
  for (const r of ranges) {
    if (r.start > cursor) {
      segments.push({ type: 'text', content: text.slice(cursor, r.start) })
    }
    segments.push({
      type: 'phrase',
      content: text.slice(r.start, r.end),
      phraseIndex: r.index,
    })
    cursor = r.end
  }
  if (cursor < text.length) {
    segments.push({ type: 'text', content: text.slice(cursor) })
  }
  return segments
}

const SEGMENTS = buildSegments(ARTICLE_TEXT, HIGHLIGHT_PHRASES)

export function LandingTippingDemo() {
  const [activeIndex, setActiveIndex] = useState(0)
  const [animationStep, setAnimationStep] = useState<AnimationStep>('idle')
  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearAllTimeouts = useCallback(() => {
    timeoutRefs.current.forEach(clearTimeout)
    timeoutRefs.current = []
  }, [])

  const addTimeout = useCallback((fn: () => void, delay: number) => {
    const id = setTimeout(fn, delay)
    timeoutRefs.current.push(id)
    return id
  }, [])

  useEffect(() => {
    clearAllTimeouts()
    setAnimationStep('idle')

    addTimeout(() => setAnimationStep('selecting'), 80)
    addTimeout(() => setAnimationStep('highlighted'), 440)
    addTimeout(() => setAnimationStep('tipped'), 620)
    addTimeout(() => {
      setAnimationStep('idle')
      addTimeout(() => {
        setActiveIndex((prev) => (prev + 1) % HIGHLIGHT_PHRASES.length)
      }, 80)
    }, 1350)

    return clearAllTimeouts
  }, [activeIndex, clearAllTimeouts, addTimeout])

  const renderArticleText = () => (
    <>
      {SEGMENTS.map((seg, i) => {
        if (seg.type === 'text') {
          return <span key={i}>{seg.content}</span>
        }

        const { phraseIndex } = seg
        const isActive = phraseIndex === activeIndex
        const isSelecting = isActive && animationStep === 'selecting'
        const isHighlighted =
          isActive &&
          (animationStep === 'highlighted' || animationStep === 'tipped')
        const showTip = isActive && animationStep === 'tipped'

        return (
          <span key={i} className="relative inline">
            {isSelecting && (
              <motion.span
                className="absolute inset-y-0 left-0 bg-info/25 rounded-[2px]"
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                style={{ zIndex: 0 }}
              />
            )}
            {isHighlighted && (
              <motion.span
                className="absolute -inset-y-0.5 -left-0.5 -right-0.5 rounded-[3px] bg-warning/30"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                style={{ zIndex: 0 }}
              />
            )}
            <span
              className={`relative z-10 ${isHighlighted ? 'text-foreground' : ''}`}
            >
              {seg.content}
            </span>

            <AnimatePresence>
              {showTip && (
                <motion.span
                  key="tip"
                  className="absolute -top-9 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 bg-popover text-popover-foreground border border-border text-[11px] font-semibold px-3 py-1.5 rounded-full shadow-xl whitespace-nowrap"
                  initial={{ opacity: 0, y: 6, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.9 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                >
                  <Zap className="w-3 h-3 text-warning-foreground" />
                  {HIGHLIGHT_PHRASES[phraseIndex]?.tip}
                </motion.span>
              )}
            </AnimatePresence>
          </span>
        )
      })}
    </>
  )

  return (
    <div className="w-full max-w-2xl">
      <div className="relative bg-card rounded-xl border border-border shadow-[var(--card-shadow)] overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/60">
          <div className="flex gap-1.5">
            <div className="w-2 h-2 bg-border rounded-full" />
            <div className="w-2 h-2 bg-border rounded-full" />
            <div className="w-2 h-2 bg-border rounded-full" />
          </div>
          <div className="flex-1 flex justify-center">
            <div className="flex items-center gap-1.5 px-3 py-0.5 bg-card rounded-md border border-border">
              <span className="text-[10px] text-muted-foreground font-medium">
                quilltip.app/article/on-open-knowledge
              </span>
            </div>
          </div>
          <div className="w-10" />
        </div>

        <div className="px-7 sm:px-10 py-7 sm:py-8">
          <p className="text-[14px] sm:text-[15px] leading-[1.8] text-muted-foreground text-left">
            {renderArticleText()}
          </p>
        </div>
      </div>
    </div>
  )
}
