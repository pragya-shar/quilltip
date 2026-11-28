'use client'

import './signin.css'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/system/components/Button'
import { Notice } from '@/system/components/Notice'
import { TextField } from '@/system/components/TextField'
import { TextLink } from '@/system/components/TextLink'
import { focusDestination } from '@/system/inputModality'
import { useEarlySubmit } from '@/components/auth/useEarlySubmit'
import { showToast } from '@/system/toast'
import { useAuthPhase } from '@/hooks/auth/useAuthPhase'
import { usePasswordAuth } from '@/hooks/auth/usePasswordAuth'
import { runAfterSignIn } from '@/lib/auth/afterSignIn'
import { afterSignInSheet } from './afterSignInSheet'
import { resetHref } from './resetHref'
import { AUTH_MESSAGES, type AuthMode } from '@/lib/auth/authErrors'
import { rememberResetEmail } from '@/lib/auth/passwordReset'
import { CONFIRM_MS, signInSession } from '@/lib/auth/session'
import {
  PASSWORD_RULES_ATTRIBUTE,
  passwordRuleMessage,
} from '@/lib/validations/password-rules'

type FieldErrors = { email?: string; password?: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The server's password rule, for password managers that generate one. */
const PASSWORD_RULES: Record<string, string> = {
  passwordrules: PASSWORD_RULES_ATTRIBUTE,
}

function check(mode: AuthMode, email: string, password: string): FieldErrors {
  const errors: FieldErrors = {}
  if (!email.trim()) errors.email = 'Enter your email.'
  else if (!EMAIL.test(email.trim()))
    errors.email = 'Enter an email like name@example.com.'
  if (!password) errors.password = 'Enter your password.'
  else if (mode === 'create')
    errors.password = passwordRuleMessage(password) ?? undefined
  return errors
}

/**
 * Sign in, or create an account, with an email and a password: the form the
 * sign-in sheet and the /signin page share. A real form with labelled
 * fields, so password managers fill it. An error says what is wrong, once,
 * with focus on the field it is about. After a sign-in succeeds the form
 * waits until the backend confirms it, then calls `onSignedIn`. It never
 * acts on what the person was doing; that stays theirs to press again.
 */
export function SignInForm({
  initialMode = 'sign-in',
  onModeChange,
  onSignedIn,
  returnTo,
}: {
  initialMode?: AuthMode
  /** Told when the person switches between signing in and creating. */
  onModeChange?: (mode: AuthMode) => void
  onSignedIn: () => void
  /** Where the person goes back to; carried to the reset page. */
  returnTo?: string
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const { submit, pending } = usePasswordAuth()
  const phase = useAuthPhase()
  const email = useRef<HTMLInputElement>(null)
  const password = useRef<HTMLInputElement>(null)
  const notice = useRef<HTMLDivElement>(null)
  const status = useRef<HTMLParagraphElement>(null)
  const otherWay = useRef<HTMLDivElement>(null)
  // With the password focused, its two buttons stay in view, also when the
  // keyboard opens or the visible area changes after focus (the sheet then
  // scrolls its body; this runs after the shell's own scroll).
  const keepButtonsInView = () =>
    requestAnimationFrame(() => {
      if (document.activeElement !== password.current) return
      otherWay.current?.scrollIntoView({ block: 'nearest' })
    })
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    viewport.addEventListener('resize', keepButtonsInView)
    return () => viewport.removeEventListener('resize', keepButtonsInView)
  })
  // A press before the page script runs is held, then sent once from here.
  const early = useEarlySubmit('signin')
  const done = useRef(onSignedIn)
  useEffect(() => {
    done.current = onSignedIn
  })

  // Signed in and confirmed by the backend: the after-sign-in steps run
  // (each bounded in time, none able to hold the person), anything they say
  // is shown, and the caller takes over.
  useEffect(() => {
    if (!waiting || phase !== 'signed-in') return
    let live = true
    void runAfterSignIn().then((notices) => {
      if (!live) return
      setWaiting(false)
      done.current()
      // A notice never covers the sign-in sheet: it waits for it to close.
      afterSignInSheet(() => {
        for (const title of notices) showToast({ title, tone: 'done' })
      })
    })
    return () => {
      live = false
    }
  }, [waiting, phase])
  // Not confirmed in time: say so, and let them try again.
  useEffect(() => {
    if (!waiting) return
    const id = window.setTimeout(() => {
      signInSession.settle()
      setWaiting(false)
      setFormError(
        'Signing in is taking longer than usual. Check your connection and try again.'
      )
    }, CONFIRM_MS)
    return () => window.clearTimeout(id)
  }, [waiting])
  useEffect(() => {
    if (formError) focusDestination(notice.current)
  }, [formError])
  useEffect(() => {
    if (waiting) focusDestination(status.current)
  }, [waiting])

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending || waiting) return
    const values = {
      email: email.current?.value ?? '',
      password: password.current?.value ?? '',
    }
    const found = check(mode, values.email, values.password)
    setErrors(found)
    setFormError(null)
    if (found.email || found.password) {
      ;(found.email ? email : password).current?.focus()
      return
    }
    const result = await submit(mode, values)
    if (!result) return
    if (result.ok) {
      setWaiting(true)
      return
    }
    // Creating an account with an email that has one: the password typed
    // may be that account's (a returning reader who did not switch), so
    // it signs in with it. If not, the form becomes the sign-in form with
    // the email kept. Sign-up already says an email is taken, so this
    // tells nobody more than that.
    if (result.failure.code === 'email-in-use') {
      setMode('sign-in')
      onModeChange?.('sign-in')
      const again = await submit('sign-in', values)
      if (again?.ok) {
        setWaiting(true)
        return
      }
      if (password.current) password.current.value = ''
      setErrors({ password: AUTH_MESSAGES.accountExists })
      password.current?.focus()
      return
    }
    const { field, message } = result.failure
    if (field) {
      setErrors({ [field]: message })
      ;(field === 'email' ? email : password).current?.focus()
    } else setFormError(message)
  }

  const switchMode = () => {
    const next = mode === 'sign-in' ? 'create' : 'sign-in'
    setMode(next)
    onModeChange?.(next)
    setErrors({})
    setFormError(null)
  }

  return (
    <div className="qt-signin">
      {formError ? (
        <div ref={notice} tabIndex={-1} className="qt-signin__notice">
          <Notice tone="failure">{formError}</Notice>
        </div>
      ) : null}
      {waiting ? (
        <p
          className="qt-signin__status"
          ref={status}
          tabIndex={-1}
          role="status"
        >
          {mode === 'create'
            ? 'Account created. Signing you in…'
            : 'Signing you in…'}
        </p>
      ) : null}
      {/* method="post" keeps an email and password out of the address if
          the form is sent before the page's script has loaded; on /signin
          the early-submit script holds that press until the script runs. */}
      <form
        {...early}
        className="qt-signin__form"
        method="post"
        noValidate
        onSubmit={onSubmit}
        aria-busy={pending || waiting || undefined}
        hidden={waiting}
      >
        <TextField
          ref={email}
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          // "username" is the field password managers save and fill.
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          // The keyboard's key moves on to the password; it never sends a
          // form with the password still empty.
          enterKeyHint="next"
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || password.current?.value) return
            event.preventDefault()
            password.current?.focus()
          }}
          error={errors.email}
          onChange={() =>
            errors.email && setErrors((e) => ({ ...e, email: undefined }))
          }
        />
        <TextField
          ref={password}
          label="Password"
          name="password"
          type={showPassword ? 'text' : 'password'}
          autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
          enterKeyHint="go"
          onFocus={keepButtonsInView}
          {...(mode === 'create' ? PASSWORD_RULES : null)}
          // The rule shows once: an error about it takes the hint's place.
          hint={
            mode === 'create' && !errors.password
              ? 'At least 8 characters. A few words make a good one.'
              : undefined
          }
          error={errors.password}
          onChange={() =>
            errors.password && setErrors((e) => ({ ...e, password: undefined }))
          }
        />
        <Button
          type="submit"
          variant="primary"
          size="l"
          block
          loading={pending}
        >
          {/* While a press made before the page script ran is held, CSS
              shows "One moment…" in place of the label. */}
          <span className="qt-signin__ready">
            {mode === 'create' ? 'Create account' : 'Sign in'}
          </span>
          <span className="qt-signin__held" aria-hidden="true">
            One moment…
          </span>
        </Button>
      </form>
      {waiting ? null : (
        <>
          {/* The other way in is as easy to find as this one: most people
              who meet the sheet from a first tip are new. */}
          <div ref={otherWay} className="qt-signin__other">
            <Button variant="secondary" size="l" block onClick={switchMode}>
              {mode === 'sign-in' ? 'Create an account' : 'I have an account'}
            </Button>
          </div>
          <div className="qt-signin__row">
            <button
              type="button"
              className="qt-signin__text-button"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((on) => !on)}
            >
              {showPassword ? 'Hide password' : 'Show password'}
            </button>
            {mode === 'sign-in' ? (
              // The email typed here fills the reset page (kept in this tab,
              // never in an address).
              <span
                onClickCapture={() =>
                  rememberResetEmail(email.current?.value ?? '')
                }
              >
                <TextLink href={resetHref(returnTo)} variant="standalone">
                  Forgot your password?
                </TextLink>
              </span>
            ) : null}
          </div>
          {mode === 'create' ? (
            <p className="qt-signin__fine">
              Creating an account sends no money.
            </p>
          ) : null}
          <p className="qt-signin__terms">
            By continuing you agree to the{' '}
            <TextLink href="/terms">Terms</TextLink>.
          </p>
        </>
      )}
    </div>
  )
}
