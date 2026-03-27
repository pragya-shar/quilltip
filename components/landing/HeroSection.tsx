'use client'

import Link from 'next/link'
import { ArrowRight, Zap } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useState, useCallback, useRef } from 'react'

const ARTICLE_TEXT = `Writers pour their hearts into stories that shape how we think — yet most see nothing in return. The quiet revolution of open knowledge deserves better. What if readers could reward the exact words that moved them?`

interface HighlightPhrase {
  text: string
  tip: string
}

const HIGHLIGHT_PHRASES: HighlightPhrase[] = [
  { text: 'the quiet revolution of open knowledge', tip: '+0.50 XLM' },
  { text: 'reward the exact words that moved them', tip: '+1.00 XLM' },
  { text: 'stories that shape how we think', tip: '+0.25 XLM' },
]

type AnimationStep = 'idle' | 'selecting' | 'highlighted' | 'tipped'

export default function HeroSection() {
  const [currentPhraseIndex, setCurrentPhraseIndex] = useState(0)
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
    const runSequence = () => {
      clearAllTimeouts()
      setAnimationStep('idle')

      addTimeout(() => setAnimationStep('selecting'), 200)
      addTimeout(() => setAnimationStep('highlighted'), 650)
      addTimeout(() => setAnimationStep('tipped'), 900)
      addTimeout(() => {
        setAnimationStep('idle')
        addTimeout(() => {
          setCurrentPhraseIndex((prev) => (prev + 1) % HIGHLIGHT_PHRASES.length)
        }, 150)
      }, 1800)
    }

    runSequence()
    const interval = setInterval(runSequence, 2100)

    return () => {
      clearInterval(interval)
      clearAllTimeouts()
    }
  }, [currentPhraseIndex, clearAllTimeouts, addTimeout])

  const currentPhrase =
    HIGHLIGHT_PHRASES[currentPhraseIndex] ?? HIGHLIGHT_PHRASES[0]

  const renderArticleText = () => {
    if (!currentPhrase) return <span>{ARTICLE_TEXT}</span>
    const phraseStart = ARTICLE_TEXT.indexOf(currentPhrase.text)
    if (phraseStart === -1) return <span>{ARTICLE_TEXT}</span>

    const before = ARTICLE_TEXT.slice(0, phraseStart)
    const phrase = ARTICLE_TEXT.slice(
      phraseStart,
      phraseStart + currentPhrase.text.length
    )
    const after = ARTICLE_TEXT.slice(phraseStart + currentPhrase.text.length)

    const isSelecting = animationStep === 'selecting'
    const isHighlighted =
      animationStep === 'highlighted' || animationStep === 'tipped'

    return (
      <>
        <span>{before}</span>
        <span className="relative inline">
          {isSelecting && (
            <motion.span
              className="absolute inset-y-0 left-0 bg-blue-200/50 rounded-[2px]"
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              style={{ zIndex: 0 }}
            />
          )}
          {isHighlighted && (
            <motion.span
              className="absolute -inset-y-0.5 -left-0.5 -right-0.5 bg-amber-200/70 rounded-[3px]"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{ zIndex: 0 }}
            />
          )}
          <span
            className={`relative z-10 ${isHighlighted ? 'text-neutral-900' : ''}`}
          >
            {phrase}
          </span>

          <AnimatePresence>
            {animationStep === 'tipped' && (
              <motion.span
                className="absolute -top-9 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 bg-neutral-900 text-white text-[11px] font-semibold px-3 py-1.5 rounded-full shadow-xl shadow-neutral-900/10 whitespace-nowrap"
                initial={{ opacity: 0, y: 6, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.9 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                <Zap className="w-3 h-3 text-amber-400" />
                {currentPhrase.tip}
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        <span>{after}</span>
      </>
    )
  }

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
      <div className="absolute inset-0 bg-gradient-to-b from-neutral-50/80 via-white to-neutral-50/30" />

      <div className="container mx-auto max-w-4xl px-6 relative z-10 py-20">
        <motion.div
          className="flex flex-col items-center text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          {/* Label chip */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          >
            <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-neutral-100 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              Live on Stellar Testnet
            </span>
          </motion.div>

          {/* Headline — Fraunces */}
          <motion.h1
            className="mt-6 font-display text-4xl sm:text-[2.75rem] lg:text-5xl font-medium tracking-[-0.01em] text-foreground leading-[1.2]"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 0.5, delay: 0.05, ease: 'easeOut' }}
          >
            Reward the words that move you
          </motion.h1>

          {/* Subtitle — Inter */}
          <motion.p
            className="mt-4 text-[15px] sm:text-base text-neutral-400 max-w-md leading-relaxed"
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
          >
            Highlight what resonates. Tip writers instantly. Powered by Stellar.
          </motion.p>

          {/* CTAs */}
          <motion.div
            className="mt-8 flex flex-col sm:flex-row items-center gap-2.5"
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 0.5, delay: 0.15, ease: 'easeOut' }}
          >
            <Link
              href="/articles"
              className="group inline-flex items-center gap-2 bg-neutral-900 text-white px-6 py-2.5 rounded-lg text-[13px] font-medium hover:bg-neutral-800 hover:shadow-lg transition-all duration-200"
            >
              Start Reading
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform duration-200" />
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 text-neutral-600 px-6 py-2.5 rounded-lg text-[13px] font-medium hover:text-neutral-900 hover:bg-neutral-100 transition-all duration-200"
            >
              Start Writing
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </motion.div>

          {/* Animation Panel */}
          <motion.div
            className="mt-14 w-full max-w-2xl"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' }}
          >
            <div className="relative bg-card rounded-xl border border-border shadow-[0_1px_12px_rgba(0,0,0,0.04)] overflow-hidden">
              {/* Browser chrome */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/60">
                <div className="flex gap-1.5">
                  <div className="w-2 h-2 bg-neutral-200 rounded-full" />
                  <div className="w-2 h-2 bg-neutral-200 rounded-full" />
                  <div className="w-2 h-2 bg-neutral-200 rounded-full" />
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

              {/* Article content */}
              <div className="px-7 sm:px-10 py-7 sm:py-8">
                <p className="text-[14px] sm:text-[15px] leading-[1.8] text-muted-foreground text-left">
                  {renderArticleText()}
                </p>
              </div>
            </div>
          </motion.div>

          {/* Metrics Strip */}
          <motion.div
            className="mt-12 flex items-center justify-center gap-8 sm:gap-12"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <div className="text-center">
              <p className="text-lg sm:text-xl font-semibold text-foreground tabular-nums">
                97.5%
              </p>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest mt-0.5">
                To Authors
              </p>
            </div>
            <div className="w-px h-6 bg-border" />
            <div className="text-center">
              <p className="text-lg sm:text-xl font-semibold text-foreground tabular-nums">
                3s
              </p>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest mt-0.5">
                Settlement
              </p>
            </div>
            <div className="w-px h-6 bg-border" />
            <div className="text-center">
              <p className="text-lg sm:text-xl font-semibold text-foreground tabular-nums">
                $0.01
              </p>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest mt-0.5">
                Min Tip
              </p>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
