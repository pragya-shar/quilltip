'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuthReturnPath } from './useAuthReturnPath'
import { useAuth } from '@/components/providers/AuthContext'
import { parseRegisterSignInError } from '@/lib/auth/map-register-error'
import { shouldUseFullPageAuthNavigation } from '@/lib/auth/postAuthNavigation'
import { readPendingTipIntent } from '@/lib/tip/pendingTipIntent'
import {
  createAccountHandle,
  prototypeSignupSchema,
  type PrototypeSignupData,
} from '@/lib/auth/prototypeSignup'
import { ArrowRight } from '@/components/landing/LandingIcons'
import { AccountField } from './AccountField'
import { AccountPasswordToggle } from './AccountPasswordToggle'

export default function RegisterForm() {
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const submitting = useRef(false)
  const handle = useRef<string | null>(null)
  const router = useRouter()
  const returnPath = useAuthReturnPath()
  const { signIn } = useAuth()
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<PrototypeSignupData>({
    resolver: zodResolver(prototypeSignupSchema),
  })
  const field = (name: keyof PrototypeSignupData) =>
    register(name, {
      onChange: () => {
        clearErrors(name)
        setFormError(null)
        setAnnouncement('')
      },
    })
  const onSubmit = async (data: PrototypeSignupData) => {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setFormError(null)
    setAnnouncement('')
    try {
      handle.current ??= createAccountHandle()
      await signIn('password', {
        ...data,
        username: handle.current,
        flow: 'signUp',
      })
      setSuccess(true)
      if (shouldUseFullPageAuthNavigation(returnPath, readPendingTipIntent())) {
        window.location.assign(returnPath)
      } else {
        router.replace(returnPath)
      }
    } catch (error) {
      const result = parseRegisterSignInError(error)
      if (result.field === 'email') {
        setError('email', { type: 'server', message: result.message })
        document.getElementById('email')?.focus()
        setAnnouncement(result.message)
      } else {
        // A handle conflict is retried with a fresh generated handle, not a hidden field error.
        if (result.field === 'username') handle.current = null
        setFormError(
          result.field === 'username'
            ? 'We couldn’t create your account. Please try again.'
            : result.message
        )
      }
      submitting.current = false
      setBusy(false)
    }
  }
  const onInvalid = (invalid: FieldErrors<PrototypeSignupData>) => {
    const first = (['name', 'email', 'password'] as const).find(
      (key) => invalid[key]
    )
    if (first) {
      setAnnouncement(invalid[first]?.message ?? 'Check your details.')
      document.getElementById(first)?.focus()
    }
  }
  if (success)
    return (
      <p className="account-notice" role="status">
        Account created successfully! Continuing where you left off…
      </p>
    )
  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit, onInvalid)}
      aria-busy={busy}
    >
      {announcement && (
        <p className="sr-only" role="alert">
          {announcement}
        </p>
      )}
      {formError && (
        <p className="account-error account-error-banner" role="alert">
          {formError}
        </p>
      )}
      <AccountField id="name" label="Your name" error={errors.name?.message}>
        <input
          {...field('name')}
          id="name"
          autoComplete="nickname"
          maxLength={80}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'name-error' : undefined}
        />
      </AccountField>
      <AccountField id="email" label="Email" error={errors.email?.message}>
        <input
          {...field('email')}
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'email-error' : undefined}
        />
      </AccountField>
      <AccountField
        id="password"
        label="Password"
        error={errors.password?.message}
      >
        <div className="account-password">
          <input
            {...field('password')}
            id="password"
            type={visible ? 'text' : 'password'}
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            aria-describedby={
              errors.password ? 'password-hint password-error' : 'password-hint'
            }
          />
          <AccountPasswordToggle
            visible={visible}
            onToggle={() => setVisible(!visible)}
          />
        </div>
        <p id="password-hint" className="account-hint">
          At least 8 characters, with uppercase, lowercase, and a number.
        </p>
      </AccountField>
      <button className="account-primary" type="submit" disabled={busy}>
        {busy ? (
          'One moment…'
        ) : (
          <>
            Create account <ArrowRight size={20} />
          </>
        )}
      </button>
    </form>
  )
}
