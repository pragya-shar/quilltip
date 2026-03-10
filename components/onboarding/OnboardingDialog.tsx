'use client'

import { useState } from 'react'
import { useMutation } from 'convex/react'
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
  const [open, setOpen] = useState(true)
  const [currentStep, setCurrentStep] = useState(0)
  const completeOnboarding = useMutation(api.users.completeOnboarding)

  const handleComplete = async () => {
    try {
      await completeOnboarding()
    } catch {
      // Non-critical — silently fail
    }
    setOpen(false)
  }

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      handleComplete()
    }
  }

  const step = steps[currentStep]
  if (!step) return null
  const StepIcon = step.icon

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) handleComplete()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="sr-only">Welcome to Quilltip</DialogTitle>
          <DialogDescription className="sr-only">
            Getting started guide for new users
          </DialogDescription>
        </DialogHeader>

        {/* Step indicators */}
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

        {/* Actions */}
        <div className="flex flex-col gap-2 mt-2">
          {currentStep === 1 && (
            <div className="flex gap-2">
              <Link
                href="/guide"
                onClick={() => handleComplete()}
                className="flex-1"
              >
                <Button className="w-full" variant="default">
                  <HelpCircle className="w-4 h-4 mr-2" />
                  Set Up Now
                </Button>
              </Link>
              <Button variant="outline" className="flex-1" onClick={handleNext}>
                I&apos;ll do this later
              </Button>
            </div>
          )}

          {currentStep === 2 && (
            <div className="grid grid-cols-3 gap-2">
              <Link href="/articles" onClick={() => handleComplete()}>
                <Button variant="outline" className="w-full" size="sm">
                  <BookOpen className="w-3.5 h-3.5 mr-1" />
                  Read
                </Button>
              </Link>
              <Link href="/write" onClick={() => handleComplete()}>
                <Button variant="outline" className="w-full" size="sm">
                  <PenSquare className="w-3.5 h-3.5 mr-1" />
                  Write
                </Button>
              </Link>
              <Link href="/guide" onClick={() => handleComplete()}>
                <Button variant="outline" className="w-full" size="sm">
                  <HelpCircle className="w-3.5 h-3.5 mr-1" />
                  Guide
                </Button>
              </Link>
            </div>
          )}

          {currentStep < 2 && currentStep !== 1 && (
            <Button onClick={handleNext} className="w-full">
              Next
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}

          {currentStep === 2 && (
            <Button onClick={handleComplete} className="w-full">
              Get Started
            </Button>
          )}

          <button
            onClick={handleComplete}
            className="text-sm text-neutral-400 hover:text-neutral-600 transition-colors"
          >
            Skip
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
