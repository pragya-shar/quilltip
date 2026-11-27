'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useAuthActions } from '@convex-dev/auth/react'
import { ConvexError } from 'convex/values'
import { ArrowRight } from '@/components/landing/LandingIcons'
import {
  RESET_CODE_TTL_MINUTES,
  recallResetEmail,
  rememberResetEmail,
  resetRequestErrorCopy,
} from '@/lib/auth/passwordReset'
import { AccountField } from './AccountField'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RESEND_AFTER_S = 60

export function ForgotPasswordForm() {
  const { signIn } = useAuthActions()
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [formError, setFormError] = useState<{
    message: string
    unavailable: boolean
  } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const sentHeading = useRef<HTMLHeadingElement>(null)
  const emailInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setEmail(recallResetEmail())
  }, [])
  // Move focus to the confirmation once it has rendered.
  useEffect(() => {
    if (sentTo) sentHeading.current?.focus()
  }, [sentTo])
  // A failed submit disables the button, so move focus to the error.
  const errorBanner = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (formError) errorBanner.current?.focus()
  }, [formError])
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const validate = (value: string) =>
    !value.trim()
      ? 'Enter your email address.'
      : EMAIL_PATTERN.test(value.trim())
        ? null
        : 'Enter a valid email address.'

  async function request(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (submitting) return
    const error = validate(email)
    setEmailError(error)
    if (error) {
      emailInput.current?.focus()
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      await signIn('password', { email: email.trim(), flow: 'reset' })
      rememberResetEmail(email)
      setSentTo(email.trim())
      setCooldown(RESEND_AFTER_S)
    } catch (e) {
      const code = e instanceof ConvexError ? e.data : null
      setFormError({
        message: resetRequestErrorCopy(code),
        unavailable: code === 'PASSWORD_RESET_UNAVAILABLE',
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (sentTo)
    return (
      <div className="account-recovery-step">
        <h2 ref={sentHeading} tabIndex={-1}>
          Check your email
        </h2>
        <p role="status">
          If an account uses <strong>{sentTo}</strong>, we’ve sent an 8-digit
          code. It works once and expires in {RESET_CODE_TTL_MINUTES} minutes.
        </p>
        <Link className="account-primary" href="/reset-password">
          Enter your code <ArrowRight size={20} />
        </Link>
        {formError && (
          <div
            ref={errorBanner}
            tabIndex={-1}
            className="account-error account-error-banner"
            role="alert"
          >
            <p>{formError.message}</p>
          </div>
        )}
        <p className="account-hint">
          No email after a few minutes? Check spam, or{' '}
          <button
            type="button"
            className="account-inline-button"
            disabled={submitting || cooldown > 0}
            onClick={() => void request()}
          >
            {cooldown > 0
              ? `send another code in ${cooldown}s`
              : submitting
                ? 'sending…'
                : 'send another code'}
          </button>
          .
        </p>
        <button
          type="button"
          className="account-inline-button"
          onClick={() => {
            setSentTo(null)
            setFormError(null)
            requestAnimationFrame(() => emailInput.current?.focus())
          }}
        >
          Use a different email
        </button>
      </div>
    )

  return (
    <form noValidate onSubmit={request} aria-busy={submitting}>
      {formError && (
        <div
          ref={errorBanner}
          tabIndex={-1}
          className="account-error account-error-banner"
          role="alert"
        >
          <p>{formError.message}</p>
          {formError.unavailable && (
            <Link href="/contact">Contact Quilltip</Link>
          )}
        </div>
      )}
      <AccountField id="email" label="Email" error={emailError ?? undefined}>
        <input
          ref={emailInput}
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          aria-invalid={!!emailError}
          aria-describedby={emailError ? 'email-error' : undefined}
          onChange={(e) => {
            setEmail(e.target.value)
            if (emailError) setEmailError(validate(e.target.value))
          }}
          onBlur={(e) => {
            if (e.target.value) setEmailError(validate(e.target.value))
          }}
        />
      </AccountField>
      <button className="account-primary" type="submit" disabled={submitting}>
        {submitting ? (
          'Sending…'
        ) : (
          <>
            Send reset code <ArrowRight size={20} />
          </>
        )}
      </button>
    </form>
  )
}
