'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { rememberResetEmail } from '@/lib/auth/passwordReset'
import { useAuthActions } from '@convex-dev/auth/react'
import { useRouter } from 'next/navigation'
import { getLoginCopy } from '@/lib/copy/auth-intent'
import { shouldUseFullPageAuthNavigation } from '@/lib/auth/postAuthNavigation'
import { useForm, type Resolver } from 'react-hook-form'
import type { LoginFormData } from '@/lib/validations/auth'
import { ArrowRight } from '@/components/landing/LandingIcons'
import { AccountField } from './AccountField'
import { AccountPasswordToggle } from './AccountPasswordToggle'
import { AccountSubmitLabel } from './AccountSubmitLabel'
import { useEarlySubmit } from './useEarlySubmit'

const REDIRECT_TIMEOUT_MS = 15_000

/**
 * Validation runs on submit, so the schema library loads then instead of with
 * the page. Same schema and resolver as before.
 */
const loginResolver: Resolver<LoginFormData> = async (
  values,
  context,
  options
) => {
  const [{ zodResolver }, { loginSchema }] = await Promise.all([
    import('@hookform/resolvers/zod'),
    import('@/lib/validations/auth'),
  ])
  return zodResolver(loginSchema)(values, context, options)
}

/**
 * Login Form Component
 *
 * Handles user authentication with Convex Auth.
 * Includes form validation, error handling, and loading states.
 */

export default function LoginForm({
  returnToPath,
}: {
  /** Safe post-login path, read from the URL query by the page. */
  returnToPath: string
}) {
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const submitting = useRef(false)
  const earlySubmit = useEarlySubmit('login')

  const router = useRouter()
  const copy = getLoginCopy(returnToPath)
  const postLoginPath = returnToPath
  const { signIn } = useAuthActions()

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: loginResolver,
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
    // Loaded on submit with the validation code. If it cannot load, sign-in
    // still works; only a pending tip resumes without a full page load.
    const readPendingTipIntent =
      await import('@/lib/tip/pendingTipIntent').then(
        (mod) => mod.readPendingTipIntent,
        () => () => null
      )

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
    // A submit before the page scripts run is held, then sent through
    // onSubmit (useEarlySubmit). method="post" keeps credentials out of the
    // URL if the inline script that holds it did not run.
    <form
      {...earlySubmit}
      method="post"
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      aria-busy={isLoading}
    >
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
          <Link
            className="account-forgot-link"
            href="/forgot-password"
            onClick={() => rememberResetEmail(getValues('email') ?? '')}
          >
            Forgot password?
          </Link>
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
      <button className="account-primary" type="submit" disabled={isLoading}>
        <AccountSubmitLabel busy={isLoading} busyLabel="One moment…">
          Log in <ArrowRight size={20} />
        </AccountSubmitLabel>
      </button>
    </form>
  )
}
