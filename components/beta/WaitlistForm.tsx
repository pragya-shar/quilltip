'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import Link from 'next/link'
import { useMutation } from 'convex/react'
import { ConvexError } from 'convex/values'
import { api } from '@/convex/_generated/api'
import { ArrowRight } from '@/components/landing/LandingIcons'
import { AccountField } from '@/components/auth/AccountField'
import { track } from '@/lib/analytics/track'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function WaitlistForm() {
  const join = useMutation(api.waitlist.join)
  const openedAt = useRef(0)
  const statusRef = useRef<HTMLHeadingElement>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    openedAt.current = performance.now()
  }, [])
  useEffect(() => {
    if (done) statusRef.current?.focus()
  }, [done])

  function validateEmail(value: string) {
    if (!value.trim()) return 'Enter your email address.'
    if (!EMAIL_PATTERN.test(value.trim())) return 'Enter a valid email address.'
    return null
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email') ?? '')
    const error = validateEmail(email)
    const form = event.currentTarget
    // Render the error before moving focus, so the field is announced with
    // its error description.
    flushSync(() => setEmailError(error))
    if (error) {
      form.querySelector<HTMLInputElement>('#email')?.focus()
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      await join({
        email,
        name: String(data.get('name') ?? '') || undefined,
        interest: String(data.get('interest') ?? '') || undefined,
        website: String(data.get('website') ?? ''),
        elapsedMs: Math.round(performance.now() - openedAt.current),
        source: 'waitlist_page',
      })
      track('waitlist_joined')
      setDone(true)
    } catch (e) {
      setFormError(
        e instanceof ConvexError && typeof e.data === 'string'
          ? e.data
          : 'We couldn’t add you just now. Check your connection and try again.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (done)
    return (
      <div className="account-confirmation" role="status">
        <h2 ref={statusRef} tabIndex={-1}>
          Thanks. You’re on the list.
        </h2>
        <p>
          When a place opens, we’ll email you an invitation. If this address was
          already on the list or already has an account, nothing changes.
        </p>
        <Link className="account-primary" href="/articles">
          Browse articles while you wait <ArrowRight size={20} />
        </Link>
      </div>
    )

  return (
    <form noValidate onSubmit={onSubmit} aria-busy={submitting}>
      {formError && (
        <p className="account-error account-error-banner" role="alert">
          {formError}
        </p>
      )}
      <AccountField id="email" label="Email" error={emailError ?? undefined}>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          aria-invalid={!!emailError}
          aria-describedby={emailError ? 'email-error' : undefined}
          onChange={(e) => {
            if (emailError) setEmailError(validateEmail(e.currentTarget.value))
          }}
        />
      </AccountField>
      <AccountField id="name" label="Name (optional)">
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          maxLength={80}
        />
      </AccountField>
      <div className="account-field">
        <label htmlFor="interest">
          What would you read or write? (optional)
        </label>
        <textarea
          id="interest"
          name="interest"
          rows={3}
          maxLength={280}
          aria-describedby="interest-hint"
        />
        <p id="interest-hint" className="account-hint">
          A sentence is plenty. Up to 280 characters.
        </p>
      </div>
      {/* Honeypot for bots. Hidden from people and assistive technology. */}
      <div className="account-trap" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
        />
      </div>
      <button className="account-primary" type="submit" disabled={submitting}>
        {submitting ? (
          'Adding you…'
        ) : (
          <>
            Join the waitlist <ArrowRight size={20} />
          </>
        )}
      </button>
      <p className="account-hint account-waitlist-note">
        We use your email only for beta invitations. Tipping on Quilltip uses
        Stellar testnet: practice funds, no real money.
      </p>
    </form>
  )
}
