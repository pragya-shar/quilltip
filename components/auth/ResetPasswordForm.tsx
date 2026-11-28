'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useAuthActions } from '@convex-dev/auth/react'
import { ConvexError } from 'convex/values'
import { ArrowRight } from '@/components/landing/LandingIcons'
import {
  forgetResetEmail,
  recallResetEmail,
  resetVerifyErrorCopy,
} from '@/lib/auth/passwordReset'
import { getPasswordRuleStatuses } from '@/lib/validations/password-rules'
import { AccountField } from './AccountField'
import { AccountPasswordToggle } from './AccountPasswordToggle'
import { AccountSubmitLabel } from './AccountSubmitLabel'
import { useEarlySubmit } from './useEarlySubmit'
import {
  PASSWORD_REQUIREMENTS_ID,
  PasswordRequirements,
} from './PasswordRequirements'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
type Field = 'email' | 'code' | 'password' | 'confirm'
type Errors = Partial<Record<Field, string>>

export function ResetPasswordForm() {
  const { signIn, signOut } = useAuthActions()
  const formRef = useRef<HTMLFormElement>(null)
  const earlySubmit = useEarlySubmit('reset-password', formRef)
  const doneHeading = useRef<HTMLHeadingElement>(null)
  const [values, setValues] = useState({
    email: '',
    code: '',
    password: '',
    confirm: '',
  })
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [codeRejected, setCodeRejected] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const prefilled = useRef(false)
  useEffect(() => {
    // The emailed link carries the code in the fragment, which is never sent
    // to the server. Read it once, then drop it from the address bar and
    // browser history.
    if (prefilled.current) return
    prefilled.current = true
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    const code = (fragment.get('code') ?? '').replace(/\D/g, '').slice(0, 8)
    // Keep values typed before the page scripts ran (useEarlySubmit may
    // report them before or after this effect).
    setValues((v) => ({
      ...v,
      email: v.email || recallResetEmail(),
      code: v.code || code,
    }))
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  // Move focus to the confirmation once it has rendered.
  useEffect(() => {
    if (done) doneHeading.current?.focus()
  }, [done])
  // A failed submit disables the button, so move focus to the error.
  const errorBanner = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (formError) errorBanner.current?.focus()
  }, [formError])

  function validate(next = values): Errors {
    const result: Errors = {}
    if (!EMAIL_PATTERN.test(next.email.trim()))
      result.email = 'Enter the email address you asked for the code with.'
    if (!/^\d{8}$/.test(next.code))
      result.code = 'Enter the 8-digit code from the email.'
    if (getPasswordRuleStatuses(next.password).some((rule) => !rule.met))
      result.password = 'Choose a password that meets every requirement.'
    if (!next.confirm) result.confirm = 'Type the new password again.'
    else if (next.confirm !== next.password)
      result.confirm = 'The passwords don’t match.'
    return result
  }

  function update(field: Field, value: string) {
    const next = { ...values, [field]: value }
    setValues(next)
    if (errors[field]) {
      const nextErrors = validate(next)
      setErrors((e) => ({ ...e, [field]: nextErrors[field] }))
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    const nextErrors = validate()
    setErrors(nextErrors)
    const firstInvalid = (
      ['email', 'code', 'password', 'confirm'] as Field[]
    ).find((field) => nextErrors[field])
    if (firstInvalid) {
      formRef.current
        ?.querySelector<HTMLInputElement>(`#reset-${firstInvalid}`)
        ?.focus()
      return
    }
    setSubmitting(true)
    setFormError(null)
    setCodeRejected(false)
    try {
      await signIn('password', {
        email: values.email.trim(),
        code: values.code,
        newPassword: values.password,
        flow: 'reset-verification',
      })
      // The reset signs this browser in; sign out so the journey ends at
      // log in with the new password, as on every other device.
      await signOut().catch(() => undefined)
      forgetResetEmail()
      setDone(true)
    } catch (e) {
      const code = e instanceof ConvexError ? e.data : null
      setCodeRejected(code === 'PASSWORD_RESET_INVALID_CODE')
      setFormError(resetVerifyErrorCopy(code))
    } finally {
      setSubmitting(false)
    }
  }

  if (done)
    return (
      <div className="account-recovery-step">
        <h2 ref={doneHeading} tabIndex={-1}>
          Password updated
        </h2>
        <p role="status">
          Your new password is set, and other devices have been signed out. Log
          in to continue.
        </p>
        <Link className="account-primary" href="/login">
          Log in <ArrowRight size={20} />
        </Link>
      </div>
    )

  const describedBy = (field: Field, extra?: string) =>
    [errors[field] ? `reset-${field}-error` : null, extra]
      .filter(Boolean)
      .join(' ') || undefined

  return (
    // A submit before the page scripts run is held, then sent through
    // onSubmit (useEarlySubmit). method="post": every form with a password
    // field posts if it is ever submitted natively (e2e/server-forms.spec.ts).
    <form
      {...earlySubmit}
      method="post"
      noValidate
      onSubmit={onSubmit}
      aria-busy={submitting}
    >
      {formError && (
        <div
          ref={errorBanner}
          tabIndex={-1}
          className="account-error account-error-banner"
          role="alert"
        >
          <p>{formError}</p>
          {codeRejected && (
            <Link href="/forgot-password">Request a new code</Link>
          )}
        </div>
      )}
      <AccountField id="reset-email" label="Email" error={errors.email}>
        <input
          id="reset-email"
          type="email"
          inputMode="email"
          autoComplete="username"
          value={values.email}
          aria-invalid={!!errors.email}
          aria-describedby={describedBy('email')}
          onChange={(e) => update('email', e.target.value)}
        />
      </AccountField>
      <AccountField id="reset-code" label="Reset code" error={errors.code}>
        <input
          id="reset-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{8}"
          maxLength={8}
          spellCheck={false}
          className="account-code-input"
          value={values.code}
          aria-invalid={!!errors.code}
          aria-describedby={describedBy('code', 'reset-code-hint')}
          onChange={(e) =>
            update('code', e.target.value.replace(/\D/g, '').slice(0, 8))
          }
        />
        <p id="reset-code-hint" className="account-hint">
          8 digits, from the email we sent.
        </p>
      </AccountField>
      <AccountField
        id="reset-password"
        label="New password"
        error={errors.password}
      >
        <div className="account-password">
          <input
            id="reset-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={values.password}
            aria-invalid={!!errors.password}
            aria-describedby={describedBy('password', PASSWORD_REQUIREMENTS_ID)}
            onChange={(e) => update('password', e.target.value)}
          />
          <AccountPasswordToggle
            visible={showPassword}
            onToggle={() => setShowPassword(!showPassword)}
          />
        </div>
        <PasswordRequirements
          password={values.password}
          highlightFailures={!!errors.password}
        />
      </AccountField>
      <AccountField
        id="reset-confirm"
        label="Confirm new password"
        error={errors.confirm}
      >
        <input
          id="reset-confirm"
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          value={values.confirm}
          aria-invalid={!!errors.confirm}
          aria-describedby={describedBy('confirm')}
          onChange={(e) => update('confirm', e.target.value)}
        />
      </AccountField>
      <button className="account-primary" type="submit" disabled={submitting}>
        <AccountSubmitLabel busy={submitting} busyLabel="Updating…">
          Set new password <ArrowRight size={20} />
        </AccountSubmitLabel>
      </button>
    </form>
  )
}
