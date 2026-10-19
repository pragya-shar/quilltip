'use client'

import { useEffect, useRef, useState } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthReturnPath } from '@/components/auth/useAuthReturnPath'
import { getLoginCopy } from '@/lib/copy/auth-intent'
import { readPendingTipIntent } from '@/lib/tip/pendingTipIntent'
import { shouldUseFullPageAuthNavigation } from '@/lib/auth/postAuthNavigation'
import { getSafeReturnPath } from '@/lib/auth/safeReturnPath'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { loginSchema, type LoginFormData } from '@/lib/validations/auth'
import { ArrowRight } from '@/components/landing/LandingIcons'
import { AccountField } from './AccountField'
import { AccountPasswordToggle } from './AccountPasswordToggle'

const REDIRECT_TIMEOUT_MS = 15_000

/**
 * Login Form Component
 *
 * Handles user authentication with Convex Auth.
 * Includes form validation, error handling, and loading states.
 */

export default function LoginForm() {
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [recoveryNotice, setRecoveryNotice] = useState(false)
  const submitting = useRef(false)

  const router = useRouter()
  const searchParams = useSearchParams()
  const returnToPath = useAuthReturnPath()
  const copy = getLoginCopy(returnToPath)
  const redirectParam = searchParams.get('redirect')
  const postLoginPath =
    redirectParam != null && redirectParam !== ''
      ? getSafeReturnPath(redirectParam, returnToPath)
      : returnToPath
  const { signIn } = useAuthActions()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  })

  useEffect(() => {
    if (!success) return

    const timeout = setTimeout(() => {
      submitting.current = false
      setSuccess(false)
      setIsLoading(false)
      setError('Redirect is taking longer than expected. Try again.')
    }, REDIRECT_TIMEOUT_MS)

    return () => clearTimeout(timeout)
  }, [success])

  const onSubmit = async (data: LoginFormData) => {
    if (submitting.current) return
    submitting.current = true
    setIsLoading(true)
    setError(null)

    try {
      await signIn('password', {
        email: data.email,
        password: data.password,
        flow: 'signIn',
      })

      setSuccess(true)
      // Full navigation for tip-resume flows so auth + URL params are stable
      // before the article page mounts (avoids inconsistent client-side resume).
      const pendingTipIntent = readPendingTipIntent()
      if (shouldUseFullPageAuthNavigation(postLoginPath, pendingTipIntent)) {
        window.location.assign(postLoginPath)
        return
      }

      router.replace(postLoginPath)
    } catch {
      submitting.current = false
      setError('Invalid email or password. Please try again.')
      setIsLoading(false)
    }
  }

  if (success)
    return (
      <p className="account-notice" role="status">
        {copy.successMessage}
      </p>
    )

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} aria-busy={isLoading}>
      {error && (
        <p className="account-error account-error-banner" role="alert">
          {error}
        </p>
      )}
      <AccountField id="email" label="Email" error={errors.email?.message}>
        <input
          {...register('email')}
          type="email"
          inputMode="email"
          id="email"
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
        action={
          <button type="button" onClick={() => setRecoveryNotice(true)}>
            Forgot password?
          </button>
        }
      >
        <div className="account-password">
          <input
            {...register('password')}
            type={showPassword ? 'text' : 'password'}
            id="password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? 'password-error' : undefined}
          />
          <AccountPasswordToggle
            visible={showPassword}
            onToggle={() => setShowPassword(!showPassword)}
          />
        </div>
      </AccountField>
      {recoveryNotice && (
        <p role="status" className="account-hint account-recovery-notice">
          Password recovery is not yet available. No reset email has been sent.
        </p>
      )}
      <button className="account-primary" type="submit" disabled={isLoading}>
        {isLoading ? (
          'One moment…'
        ) : (
          <>
            Log in <ArrowRight size={20} />
          </>
        )}
      </button>
    </form>
  )
}
