'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import { api } from '@/convex/_generated/api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles,
  Wallet,
  BookOpen,
  PenSquare,
  ArrowRight,
  HelpCircle,
  X,
} from 'lucide-react'
import Link from 'next/link'

const steps = [
  {
    icon: Sparkles,
    title: 'Welcome to Quilltip',
    description:
      'A platform where readers reward writers directly. Read articles, highlight your favorite passages, and tip the authors you love — all powered by the Stellar blockchain.',
    color: 'bg-blue-100 text-blue-700',
  },
  {
    icon: Wallet,
    title: 'Set Up Your Wallet',
    description:
      'To tip writers, you need a Stellar wallet (like Freighter). It takes about 2 minutes to set up. Reading articles is always free — no wallet needed.',
    color: 'bg-amber-100 text-amber-700',
  },
  {
    icon: BookOpen,
    title: 'Start Exploring',
    description:
      'Browse articles from writers, highlight passages you love, and send tips starting at just $0.01. 97.5% goes directly to the author.',
    color: 'bg-green-100 text-green-700',
  },
]

export function OnboardingDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(true)
  const [currentStep, setCurrentStep] = useState(0)
  const [isCompleting, setIsCompleting] = useState(false)
  const completingRef = useRef(false)
  const completeOnboarding = useMutation(api.users.completeOnboarding)

  const handleComplete = async (): Promise<boolean> => {
    if (completingRef.current) return false
    completingRef.current = true
    setIsCompleting(true)
    try {
      await completeOnboarding()
      setOpen(false)
      return true
    } catch {
      toast.error('Could not save your progress. Please try again.')
      return false
    } finally {
      completingRef.current = false
      setIsCompleting(false)
    }
  }

  const navigateAfterComplete = async (href: string) => {
    const ok = await handleComplete()
    if (ok) {
      router.push(href)
    }
  }

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      void handleComplete()
    }
  }

  const step = steps[currentStep]
  if (!step) return null
  const StepIcon = step.icon

  return (
    <Dialog modal={false} open={open} onOpenChange={setOpen}>
      <DialogContent
        className="sm:max-w-md pointer-events-auto"
        overlayClassName="pointer-events-none bg-black/40"
        hideCloseButton
        onEscapeKeyDown={(e) => {
          e.preventDefault()
          void handleComplete()
        }}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-4 top-4 h-8 w-8"
          onClick={() => void handleComplete()}
          disabled={isCompleting}
          aria-label="Close onboarding"
        >
          <X className="h-4 w-4" />
        </Button>
        <DialogHeader>
          <DialogTitle className="sr-only">Welcome to Quilltip</DialogTitle>
          <DialogDescription className="sr-only">
            Getting started guide for new users
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center gap-2 mb-2">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === currentStep ? 'w-8 bg-neutral-900' : 'w-4 bg-neutral-200'
              }`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="text-center py-4"
          >
            <div className={`inline-flex p-4 rounded-2xl ${step.color} mb-4`}>
              <StepIcon className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-neutral-900 mb-2">
              {step.title}
            </h3>
            <p className="text-sm text-neutral-600 leading-relaxed max-w-sm mx-auto">
              {step.description}
            </p>
          </motion.div>
        </AnimatePresence>

        <div className="flex flex-col gap-3 mt-2">
          {currentStep === 1 && (
            <div className="flex gap-2">
              <Link
                href="/guide"
                className="flex-1"
                onClick={(e) => {
                  e.preventDefault()
                  void navigateAfterComplete('/guide')
                }}
              >
                <Button
                  className="w-full"
                  variant="default"
                  disabled={isCompleting}
                >
                  <HelpCircle className="w-4 h-4 mr-2" />
                  Set Up Now
                </Button>
              </Link>
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleNext}
                disabled={isCompleting}
              >
                I&apos;ll do this later
              </Button>
            </div>
          )}

          {currentStep === 2 && (
            <div className="grid grid-cols-3 gap-2">
              <Link
                href="/articles"
                onClick={(e) => {
                  e.preventDefault()
                  void navigateAfterComplete('/articles')
                }}
              >
                <Button
                  variant="outline"
                  className="w-full"
                  size="sm"
                  disabled={isCompleting}
                >
                  <BookOpen className="w-3.5 h-3.5 mr-1" />
                  Read
                </Button>
              </Link>
              <Link
                href="/write"
                onClick={(e) => {
                  e.preventDefault()
                  void navigateAfterComplete('/write')
                }}
              >
                <Button
                  variant="outline"
                  className="w-full"
                  size="sm"
                  disabled={isCompleting}
                >
                  <PenSquare className="w-3.5 h-3.5 mr-1" />
                  Write
                </Button>
              </Link>
              <Link
                href="/guide"
                onClick={(e) => {
                  e.preventDefault()
                  void navigateAfterComplete('/guide')
                }}
              >
                <Button
                  variant="outline"
                  className="w-full"
                  size="sm"
                  disabled={isCompleting}
                >
                  <HelpCircle className="w-3.5 h-3.5 mr-1" />
                  Guide
                </Button>
              </Link>
            </div>
          )}

          {currentStep < 2 && currentStep !== 1 && (
            <Button
              onClick={handleNext}
              className="w-full min-h-11"
              disabled={isCompleting}
            >
              Next
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}

          {currentStep === 2 && (
            <Button
              onClick={() => void handleComplete()}
              className="w-full min-h-11"
              disabled={isCompleting}
            >
              Get Started
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full min-h-12 text-base font-medium"
            onClick={() => void handleComplete()}
            disabled={isCompleting}
            aria-label="Skip onboarding"
          >
            Skip onboarding
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
