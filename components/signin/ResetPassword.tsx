'use client'

import { signInHref } from '@/shell/signIn'
import './signin.css'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/system/components/Button'
import { Notice } from '@/system/components/Notice'
import { TestnetNote } from '@/system/components/TestnetNote'
import { TextField } from '@/system/components/TextField'
import { focusDestination } from '@/system/inputModality'
import { useEarlySubmit } from '@/components/auth/useEarlySubmit'
import { usePasswordReset } from '@/hooks/auth/usePasswordReset'
import {
  RESET_CODE_TTL_MINUTES,
  recallResetEmail,
} from '@/lib/auth/passwordReset'
import {
  PASSWORD_RULES_ATTRIBUTE,
  passwordRuleMessage,
} from '@/lib/validations/password-rules'

type Step = 'request' | 'sent' | 'verify' | 'done'
type Errors = { email?: string; code?: string; password?: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Reset a password: ask for a code by email, then choose a new password with
 * the code. A link from the email opens on the second step with its code
 * filled in (the code travels in the fragment, never to a server). Errors
 * land on their field; a message about the whole step takes focus. It ends
 * with signing in with the new password.
 */
export function ResetPassword({ returnTo = '/' }: { returnTo?: string }) {
  const [step, setStep] = useState<Step>('request')
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState('')
  const { requestCode, setNewPassword, pending } = usePasswordReset()
  const email = useRef<HTMLInputElement>(null)
  const code = useRef<HTMLInputElement>(null)
  const password = useRef<HTMLInputElement>(null)
  const notice = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLParagraphElement>(null)
  const [prefill, setPrefill] = useState({ email: '', code: '' })
  // A press before the page script runs is held, then sent once from here.
  const earlyRequest = useEarlySubmit('reset-request')
  const earlyVerify = useEarlySubmit('reset-verify')

  useEffect(() => {
    const fragment = new URLSearchParams(location.hash.slice(1))
    const fromLink = (fragment.get('code') ?? '').replace(/\D/g, '').slice(0, 8)
    // The code leaves the address as soon as it is read, so it is not kept
    // in history, a bookmark or a shared link. It goes only to the reset call.
    if (location.hash)
      history.replaceState(
        history.state,
        '',
        location.pathname + location.search
      )
    setPrefill({ email: recallResetEmail(), code: fromLink })
    if (fromLink) setStep('verify')
  }, [])
  useEffect(() => {
    if (formError) focusDestination(notice.current)
  }, [formError])
  useEffect(() => {
    if (step === 'sent' || step === 'done') focusDestination(heading.current)
  }, [step])

  const focusFirst = (found: Errors) => {
    const first = (['email', 'code', 'password'] as const).find(
      (key) => found[key]
    )
    if (first) ({ email, code, password })[first].current?.focus()
  }

  const onRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = email.current?.value ?? ''
    const found: Errors = !value.trim()
      ? { email: 'Enter your email.' }
      : !EMAIL.test(value.trim())
        ? { email: 'Enter an email like name@example.com.' }
        : {}
    setErrors(found)
    setFormError(null)
    if (found.email) return focusFirst(found)
    const result = await requestCode(value)
    if (result === null) return
    if (result === 'sent') {
      setSentTo(value.trim())
      setPrefill((p) => ({ ...p, email: value.trim() }))
      setStep('sent')
    } else setFormError(result.message)
  }

  const onVerify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = {
      email: email.current?.value ?? '',
      code: (code.current?.value ?? '').replace(/\s/g, ''),
      password: password.current?.value ?? '',
    }
    const found: Errors = {}
    if (!EMAIL.test(values.email.trim()))
      found.email = 'Enter the email you asked for the code with.'
    if (!/^\d{8}$/.test(values.code))
      found.code = 'Enter the 8-digit code from the email.'
    const rule = passwordRuleMessage(values.password)
    if (rule) found.password = rule
    setErrors(found)
    setFormError(null)
    if (Object.keys(found).length > 0) return focusFirst(found)
    const result = await setNewPassword(values)
    if (result === null) return
    if (result === 'done') return setStep('done')
    if (result.field) {
      setErrors({ [result.field]: result.message })
      focusFirst({ [result.field]: result.message })
    } else setFormError(result.message)
  }

  if (step === 'done')
    return (
      <div className="qt-signin">
        <p className="qt-signin__status" ref={heading} tabIndex={-1}>
          Your password is changed. Sign in with it.
        </p>
        <Button
          variant="primary"
          size="l"
          block
          href={signInHref(returnTo === '/' ? undefined : returnTo)}
        >
          Sign in
        </Button>
      </div>
    )

  if (step === 'sent')
    return (
      <div className="qt-signin">
        <p className="qt-signin__status" ref={heading} tabIndex={-1}>
          Check your email
        </p>
        <p className="qt-signin__switch">
          If {sentTo} has an account, we sent it a code. It works once and
          expires in {RESET_CODE_TTL_MINUTES} minutes.
        </p>
        <Button
          variant="primary"
          size="l"
          block
          onClick={() => setStep('verify')}
        >
          Enter your code
        </Button>
      </div>
    )

  return (
    <div className="qt-signin">
      {formError ? (
        <div ref={notice} tabIndex={-1} className="qt-signin__notice">
          <Notice tone="failure">{formError}</Notice>
        </div>
      ) : null}
      {step === 'request' ? (
        <form
          {...earlyRequest}
          key="request"
          className="qt-signin__form"
          method="post"
          noValidate
          onSubmit={onRequest}
          aria-busy={pending || undefined}
        >
          <p className="qt-signin__switch">
            Enter your email and we send you a code to choose a new password.
          </p>
          <TextField
            ref={email}
            label="Email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={prefill.email}
            error={errors.email}
          />
          <Button
            type="submit"
            variant="primary"
            size="l"
            block
            loading={pending}
          >
            Send a code
          </Button>
          <p className="qt-signin__switch">
            Have a code?{' '}
            <button
              type="button"
              className="qt-signin__text-button"
              onClick={() => setStep('verify')}
            >
              Enter it
            </button>
          </p>
        </form>
      ) : (
        <form
          {...earlyVerify}
          key="verify"
          className="qt-signin__form"
          method="post"
          noValidate
          onSubmit={onVerify}
          aria-busy={pending || undefined}
        >
          <TextField
            ref={email}
            label="Email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={prefill.email}
            error={errors.email}
          />
          <TextField
            ref={code}
            label="Code from the email"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            defaultValue={prefill.code}
            error={errors.code}
          />
          <TextField
            ref={password}
            label="New password"
            name="password"
            type="password"
            autoComplete="new-password"
            {...{ passwordrules: PASSWORD_RULES_ATTRIBUTE }}
            hint="At least 8 characters. A few words make a good one."
            error={errors.password}
          />
          <Button
            type="submit"
            variant="primary"
            size="l"
            block
            loading={pending}
          >
            Change password
          </Button>
          <p className="qt-signin__switch">
            No code?{' '}
            <button
              type="button"
              className="qt-signin__text-button"
              onClick={() => setStep('request')}
            >
              Send one
            </button>
          </p>
        </form>
      )}
      <TestnetNote />
    </div>
  )
}
