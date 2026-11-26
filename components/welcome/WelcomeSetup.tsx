'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useAuth } from '@/components/providers/AuthContext'
import { useRedirectWhenUnauthenticated } from '@/hooks/useRedirectWhenUnauthenticated'
import { LandingWordmark } from '@/components/landing/LandingWordmark'
import { SignedInAccountMenu } from '@/components/layout/SignedInAccountMenu'
import {
  welcomeDestination,
  DEFAULT_WELCOME_DESTINATION,
} from '@/lib/profile/welcomeDestination'
import { WelcomeHandleStep } from './WelcomeHandleStep'
import { WelcomeProfileStep } from './WelcomeProfileStep'

const STEPS = {
  handle: {
    title: 'Choose your handle',
    lead: 'Readers find you by it. It becomes the link to your writer page.',
  },
  profile: {
    title: 'Add a photo and a short bio',
    lead: 'Both are optional. They help readers recognise your articles.',
  },
} as const

/**
 * Shown once after signup: pick a handle, then an optional photo and bio.
 * Finishing or skipping marks setup complete, so it does not come back.
 */
export function WelcomeSetup() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, isAuthenticated, isLoading } = useAuth()
  const completeOnboarding = useMutation(api.users.completeOnboarding)
  const [step, setStep] = useState<keyof typeof STEPS>('handle')
  const [finishing, setFinishing] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)
  useRedirectWhenUnauthenticated(isLoading, isAuthenticated)

  const destination = welcomeDestination(searchParams.get('next'))
  const primaryLabel =
    destination === DEFAULT_WELCOME_DESTINATION ? 'Start writing' : 'Continue'

  // Setup is once: writers who already finished go straight on.
  const alreadyDone = Boolean(user?.onboardingCompleted) && !finishing
  useEffect(() => {
    if (alreadyDone) router.replace(destination)
  }, [alreadyDone, destination, router])

  // Move focus to the new step's heading so screen readers hear it.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    headingRef.current?.focus()
  }, [step])

  async function finish(choice: 'primary' | 'articles' | 'skip') {
    setFinishing(true)
    await completeOnboarding({})
    router.replace(choice === 'articles' ? '/articles' : destination)
  }

  const ready = !isLoading && isAuthenticated && user && !alreadyDone
  const copy = STEPS[step]

  return (
    <div className="welcome-surface">
      <header className="welcome-header site-chrome">
        <LandingWordmark />
        <SignedInAccountMenu />
      </header>
      <main id="welcome-content" className="welcome-main">
        <section className="welcome-card" aria-labelledby="welcome-title">
          {ready ? (
            <>
              <p className="welcome-step">
                Step {step === 'handle' ? 1 : 2} of 2
              </p>
              <h1 id="welcome-title" ref={headingRef} tabIndex={-1}>
                {copy.title}
              </h1>
              <p className="welcome-lead">{copy.lead}</p>
              <div className="welcome-step-body" key={step}>
                {step === 'handle' ? (
                  <WelcomeHandleStep
                    currentHandle={user.username}
                    onDone={() => setStep('profile')}
                  />
                ) : (
                  <WelcomeProfileStep
                    name={user.name || user.username}
                    username={user.username}
                    avatar={user.avatar}
                    initialBio={user.bio ?? ''}
                    primaryLabel={primaryLabel}
                    onFinish={finish}
                  />
                )}
              </div>
            </>
          ) : (
            <>
              <h1 id="welcome-title" className="sr-only">
                Set up your profile
              </h1>
              <p role="status" className="welcome-lead">
                Getting your account ready…
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  )
}
