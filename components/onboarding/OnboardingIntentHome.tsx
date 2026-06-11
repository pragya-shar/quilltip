'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import { api } from '@/convex/_generated/api'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { TESTNET_PRACTICE_NOTE } from '@/lib/copy/network-status'
import { cn } from '@/lib/utils'

type IntentId = 'read' | 'write' | 'wallet'

const INTENTS: {
  id: IntentId
  title: string
  description: string
  href: string
  imageSrc: string
  imageWidth: number
  imageHeight: number
  imageClassName?: string
}[] = [
  {
    id: 'read',
    title: 'Read first',
    description: 'Discover stories and tip the writers you love.',
    href: '/articles',
    imageSrc: '/onboarding/read-first-illustration.png',
    imageWidth: 305,
    imageHeight: 324,
  },
  {
    id: 'write',
    title: 'Write first',
    description: 'Publish on Arweave and earn tips from readers.',
    href: '/write',
    imageSrc: '/onboarding/write-first-illustration.jpg',
    imageWidth: 350,
    imageHeight: 350,
  },
  {
    id: 'wallet',
    title: 'Set up wallet',
    description: 'Connect a Stellar testnet wallet to send practice tips.',
    href: '/guide',
    imageSrc: '/onboarding/wallet-setup-illustration.jpg',
    imageWidth: 513,
    imageHeight: 802,
    imageClassName: 'h-[6.75rem] w-auto max-w-full object-contain',
  },
]

export function OnboardingIntentHome() {
  const router = useRouter()
  const [selected, setSelected] = useState<IntentId | null>(null)
  const [isCompleting, setIsCompleting] = useState(false)
  const completingRef = useRef(false)
  const completeOnboarding = useMutation(api.users.completeOnboarding)

  const handleComplete = async (): Promise<boolean> => {
    if (completingRef.current) return false
    completingRef.current = true
    setIsCompleting(true)
    try {
      await completeOnboarding()
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

  const handleContinue = () => {
    const intent = INTENTS.find((item) => item.id === selected)
    if (intent) {
      void navigateAfterComplete(intent.href)
    }
  }

  return (
    <section
      className="flex flex-col justify-center min-h-[calc(100vh-5rem)] px-4 py-12"
      aria-busy={isCompleting}
      aria-labelledby="onboarding-heading"
    >
      <div className="max-w-4xl mx-auto w-full">
        <div className="text-center mb-10">
          <h1
            id="onboarding-heading"
            className="text-3xl font-bold text-foreground mb-3"
          >
            Welcome to Quilltip
          </h1>
          <p className="text-muted-foreground leading-relaxed">
            Reading and writing are free. Choose where to start.
          </p>
        </div>

        <div
          role="radiogroup"
          aria-label="Choose where to start"
          className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8"
        >
          {INTENTS.map((intent) => {
            const isSelected = selected === intent.id

            return (
              <button
                key={intent.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={isCompleting}
                onClick={() => setSelected(intent.id)}
                className={cn(
                  'relative flex flex-col text-left rounded-[var(--card-radius)] border bg-card p-5 transition-all',
                  'hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                  'disabled:opacity-50 disabled:pointer-events-none',
                  isSelected
                    ? 'border-primary ring-1 ring-primary shadow-sm'
                    : 'border-border'
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-4 right-4 h-5 w-5 rounded-full border-2 flex items-center justify-center',
                    isSelected ? 'border-primary' : 'border-muted-foreground/40'
                  )}
                >
                  {isSelected ? (
                    <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                  ) : null}
                </span>

                <div
                  aria-hidden
                  className="mb-5 flex h-28 items-center justify-center rounded-lg border border-border/60 overflow-hidden bg-white"
                >
                  <Image
                    src={intent.imageSrc}
                    alt=""
                    width={intent.imageWidth}
                    height={intent.imageHeight}
                    className={
                      intent.imageClassName ??
                      'h-[5.5rem] w-auto object-contain'
                    }
                  />
                </div>

                <h2 className="text-base font-semibold text-foreground mb-1.5 pr-6">
                  {intent.title}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {intent.description}
                </p>
              </button>
            )
          })}
        </div>

        <div className="flex flex-col items-center gap-6">
          <Button
            type="button"
            size="lg"
            className="w-full sm:w-auto min-w-48 min-h-11 text-base px-10"
            disabled={!selected || isCompleting}
            onClick={handleContinue}
          >
            {isCompleting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              'Continue'
            )}
          </Button>

          <p className="text-sm text-muted-foreground text-center max-w-md">
            {TESTNET_PRACTICE_NOTE}
          </p>

          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            disabled={isCompleting}
            onClick={() => void handleComplete()}
            aria-label="Skip for now"
          >
            Skip for now
          </button>
        </div>
      </div>
    </section>
  )
}
