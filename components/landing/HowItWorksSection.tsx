'use client'

import Link from 'next/link'
import { useState, useRef, type KeyboardEvent } from 'react'
import {
  UserPlus,
  Edit3,
  Globe,
  Coins,
  ArrowRight,
  Sparkles,
  BookOpen,
  Highlighter,
  Wallet,
  Heart,
} from 'lucide-react'
import { motion, AnimatePresence, useInView } from 'motion/react'
import { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'

type StepVariant = 'desktop' | 'mobile'

interface Step {
  icon: LucideIcon
  title: string
  description: string
  detail: string
}

function stepTabId(
  tab: 'writers' | 'readers',
  index: number,
  variant: StepVariant
) {
  return `how-it-works-${tab}-${variant}-tab-${index}`
}

function stepPanelId(
  tab: 'writers' | 'readers',
  index: number,
  variant: StepVariant
) {
  return `how-it-works-${tab}-${variant}-panel-${index}`
}

const stepTabFocusClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-spotlight'

const stepCardBaseClass =
  'relative rounded-2xl border overflow-hidden transition-colors duration-300 text-left w-full p-0 bg-transparent'

export default function HowItWorksSection() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })
  const isMobile = useIsMobile()
  const [activeTab, setActiveTab] = useState<'writers' | 'readers'>('writers')
  const [activeStep, setActiveStep] = useState(0)

  const writerSteps: Step[] = [
    {
      icon: UserPlus,
      title: 'Sign Up',
      description:
        'Create your account and connect your Stellar wallet in seconds',
      detail:
        'One-click registration with your email. Connect Freighter wallet to start receiving tips instantly.',
    },
    {
      icon: Edit3,
      title: 'Write',
      description:
        'Craft compelling content with our intuitive rich text editor',
      detail:
        'Full markdown support, code blocks, media embeds, and a distraction-free writing experience.',
    },
    {
      icon: Globe,
      title: 'Publish',
      description: 'Share your work with the world on the blockchain',
      detail:
        'Your article is stored permanently on Arweave. A tamper-proof record of your creative work, forever.',
    },
    {
      icon: Coins,
      title: 'Earn',
      description: 'Receive instant tips from readers who value your work',
      detail:
        'Tips settle in 3 seconds via Stellar. You keep 97.5% of every tip — no waiting periods.',
    },
  ]

  const readerSteps: Step[] = [
    {
      icon: BookOpen,
      title: 'Browse',
      description: 'Discover articles from writers across the platform',
      detail:
        'All articles are free to read. Explore by topic, trending, or latest. No paywalls, ever.',
    },
    {
      icon: Highlighter,
      title: 'Highlight',
      description: 'Select your favorite passages and save them',
      detail:
        'Mark the words that resonate with you. Add colors and notes to build your personal collection.',
    },
    {
      icon: Wallet,
      title: 'Connect',
      description: 'Set up a Stellar wallet in 2 minutes',
      detail:
        "Install Freighter, fund with free testnet XLM, and you're ready to tip your favorite writers.",
    },
    {
      icon: Heart,
      title: 'Tip',
      description: 'Send micro-tips starting at $0.01',
      detail:
        'Tip an article or a specific highlight. 97.5% goes directly to the author — near-zero fees.',
    },
  ]

  const steps = activeTab === 'writers' ? writerSteps : readerSteps
  const stepsTablistLabel =
    activeTab === 'writers' ? 'Writer steps' : 'Reader steps'

  const handleTabChange = (tab: 'writers' | 'readers') => {
    setActiveTab(tab)
    setActiveStep(0)
  }

  const handleStepTabKeyDown = (
    e: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    if (
      e.key !== 'ArrowRight' &&
      e.key !== 'ArrowDown' &&
      e.key !== 'ArrowLeft' &&
      e.key !== 'ArrowUp'
    ) {
      return
    }
    e.preventDefault()
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
    const next = (index + delta + steps.length) % steps.length
    setActiveStep(next)
    const variant: StepVariant = isMobile ? 'mobile' : 'desktop'
    document.getElementById(stepTabId(activeTab, next, variant))?.focus()
  }

  return (
    <section
      id="how-it-works"
      className="py-32 px-6 bg-spotlight text-spotlight-foreground relative overflow-hidden"
    >
      {/* Subtle background grain */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_color-mix(in_oklab,var(--spotlight-foreground)_6%,transparent)_0%,_transparent_60%)]" />

      <div className="container mx-auto max-w-7xl relative z-10" ref={ref}>
        {/* Section Header */}
        <motion.div
          className="mb-16"
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.8 }}
        >
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8">
            <div>
              <motion.div
                className="inline-flex items-center gap-2 px-4 py-2 bg-foreground/5 backdrop-blur-sm rounded-full border border-foreground/10 mb-6"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={
                  isInView
                    ? { opacity: 1, scale: 1 }
                    : { opacity: 0, scale: 0.9 }
                }
                transition={{ duration: 0.5 }}
              >
                <Sparkles className="w-3.5 h-3.5 text-spotlight-muted" />
                <span className="text-[11px] font-semibold text-spotlight-muted uppercase tracking-wider">
                  Simple Process
                </span>
              </motion.div>

              <h2 className="font-display text-4xl lg:text-5xl font-medium tracking-[-0.01em] mb-4 leading-[1.15]">
                <span className="text-spotlight-foreground">
                  From idea to impact,{' '}
                </span>
                <span className="text-spotlight-muted italic">
                  in four steps.
                </span>
              </h2>
              <p className="text-[15px] text-spotlight-muted max-w-lg leading-relaxed">
                Whether you write or read, Quilltip makes it simple to
                participate in the future of publishing.
              </p>
            </div>

            {/* Writer / Reader Toggle */}
            <div
              role="tablist"
              aria-label="Audience"
              className="inline-flex items-center bg-foreground/5 rounded-lg p-1 border border-foreground/10 shrink-0"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'writers'}
                onClick={() => handleTabChange('writers')}
                className={cn(
                  'px-5 py-2 rounded-md text-[13px] font-medium transition-all duration-200',
                  stepTabFocusClass,
                  activeTab === 'writers'
                    ? 'bg-card text-card-foreground shadow-sm'
                    : 'text-spotlight-muted hover:text-spotlight-foreground'
                )}
              >
                For Writers
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'readers'}
                onClick={() => handleTabChange('readers')}
                className={cn(
                  'px-5 py-2 rounded-md text-[13px] font-medium transition-all duration-200',
                  stepTabFocusClass,
                  activeTab === 'readers'
                    ? 'bg-card text-card-foreground shadow-sm'
                    : 'text-spotlight-muted hover:text-spotlight-foreground'
                )}
              >
                For Readers
              </button>
            </div>
          </div>
        </motion.div>

        {/* Expandable Steps — Desktop */}
        <motion.div
          role="tablist"
          aria-label={stepsTablistLabel}
          aria-orientation="horizontal"
          aria-hidden={isMobile}
          inert={isMobile ? true : undefined}
          className="hidden md:flex gap-2 h-[340px]"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          {steps.map((step, index) => {
            const isActive = activeStep === index
            const tabId = stepTabId(activeTab, index, 'desktop')
            const panelId = stepPanelId(activeTab, index, 'desktop')
            return (
              <motion.div
                key={`${activeTab}-${step.title}`}
                className={cn(
                  stepCardBaseClass,
                  'flex flex-col min-h-0',
                  isActive
                    ? 'border-foreground/15 bg-foreground/[0.04]'
                    : 'border-foreground/[0.06] bg-foreground/[0.02]'
                )}
                animate={{ flex: isActive ? 3 : 1 }}
                transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
              >
                <motion.button
                  type="button"
                  role="tab"
                  id={tabId}
                  aria-selected={isActive}
                  aria-controls={panelId}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveStep(index)}
                  onMouseEnter={() => setActiveStep(index)}
                  onKeyDown={(e) => handleStepTabKeyDown(e, index)}
                  className={cn(
                    'block h-full w-full cursor-pointer',
                    stepTabFocusClass,
                    !isActive &&
                      'hover:bg-foreground/[0.03] hover:border-foreground/10'
                  )}
                >
                  <AnimatePresence mode="wait">
                    {!isActive ? (
                      <motion.div
                        key="collapsed"
                        className="h-full flex flex-col items-center justify-center gap-4 px-4"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <div className="w-12 h-12 rounded-full border border-foreground/10 flex items-center justify-center">
                          <step.icon className="w-5 h-5 text-spotlight-muted" />
                        </div>
                        <span className="text-[15px] font-medium text-spotlight-muted [writing-mode:vertical-lr] tracking-wide">
                          {step.title}
                        </span>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="expanded-header"
                        className="p-8 pb-0"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3, delay: 0.15 }}
                      >
                        <div className="flex items-center gap-4 mb-6">
                          <div className="w-14 h-14 rounded-2xl bg-foreground/10 border border-foreground/10 flex items-center justify-center">
                            <step.icon className="w-6 h-6 text-spotlight-foreground" />
                          </div>
                          <h3 className="text-3xl font-display font-medium text-spotlight-foreground tracking-tight">
                            {step.title}
                          </h3>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.button>

                <div
                  role="tabpanel"
                  id={panelId}
                  aria-labelledby={tabId}
                  hidden={!isActive}
                  className={cn(
                    'flex flex-col justify-between flex-1',
                    isActive ? 'flex' : 'hidden'
                  )}
                >
                  <AnimatePresence mode="wait">
                    {isActive && (
                      <motion.div
                        key="expanded-panel"
                        className="flex flex-col justify-between flex-1 px-8 pb-8"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3, delay: 0.15 }}
                      >
                        <div>
                          <p className="text-[15px] text-spotlight-foreground/85 leading-relaxed mb-3 max-w-md">
                            {step.description}
                          </p>
                          <p className="text-[13px] text-spotlight-muted leading-relaxed max-w-md">
                            {step.detail}
                          </p>
                        </div>

                        <div
                          className="flex items-center gap-2"
                          aria-hidden="true"
                        >
                          {steps.map((_, i) => (
                            <div
                              key={i}
                              className={cn(
                                'h-1 rounded-full transition-all duration-300',
                                i === index
                                  ? 'w-8 bg-spotlight-foreground'
                                  : 'w-2 bg-spotlight-foreground/20'
                              )}
                            />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )
          })}
        </motion.div>

        {/* Steps — Mobile (vertical accordion) */}
        <motion.div
          role="tablist"
          aria-label={stepsTablistLabel}
          aria-orientation="vertical"
          aria-hidden={!isMobile}
          inert={!isMobile ? true : undefined}
          className="md:hidden space-y-2"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          {steps.map((step, index) => {
            const isActive = activeStep === index
            const tabId = stepTabId(activeTab, index, 'mobile')
            const panelId = stepPanelId(activeTab, index, 'mobile')
            return (
              <motion.div
                key={`${activeTab}-${step.title}`}
                className={cn(
                  stepCardBaseClass,
                  isActive
                    ? 'border-foreground/15 bg-foreground/[0.04]'
                    : 'border-foreground/[0.06] bg-foreground/[0.02]'
                )}
              >
                <motion.button
                  type="button"
                  role="tab"
                  id={tabId}
                  aria-selected={isActive}
                  aria-controls={panelId}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveStep(index)}
                  onKeyDown={(e) => handleStepTabKeyDown(e, index)}
                  className={cn(
                    'block w-full cursor-pointer',
                    stepTabFocusClass
                  )}
                >
                  <div className="flex items-center gap-4 p-5">
                    <div
                      className={cn(
                        'w-11 h-11 rounded-xl flex items-center justify-center transition-colors duration-300',
                        isActive
                          ? 'bg-foreground/10 border border-foreground/10'
                          : 'bg-foreground/5 border border-foreground/[0.06]'
                      )}
                    >
                      <step.icon
                        className={cn(
                          'w-5 h-5 transition-colors duration-300',
                          isActive
                            ? 'text-spotlight-foreground'
                            : 'text-spotlight-muted'
                        )}
                      />
                    </div>
                    <span
                      className={cn(
                        'text-[15px] font-medium transition-colors duration-300',
                        isActive
                          ? 'text-spotlight-foreground'
                          : 'text-spotlight-muted'
                      )}
                    >
                      {step.title}
                    </span>
                  </div>
                </motion.button>

                <div
                  role="tabpanel"
                  id={panelId}
                  aria-labelledby={tabId}
                  hidden={!isActive}
                >
                  <AnimatePresence>
                    {isActive && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                      >
                        <div className="px-5 pb-5 pl-20">
                          <p className="text-[14px] text-spotlight-foreground/85 leading-relaxed mb-2">
                            {step.description}
                          </p>
                          <p className="text-[12px] text-spotlight-muted leading-relaxed">
                            {step.detail}
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )
          })}
        </motion.div>

        {/* CTA */}
        <motion.div
          className="mt-16 text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8, delay: 0.8 }}
        >
          <Link
            href="/register"
            className="focus-ring group inline-flex items-center justify-center gap-2 bg-card text-card-foreground px-6 py-2.5 rounded-lg text-[13px] font-medium hover:bg-muted transition-all duration-200"
          >
            Start Writing & Earning Today
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform duration-200" />
          </Link>
        </motion.div>
      </div>
    </section>
  )
}
