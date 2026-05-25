'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { parseRegisterSignInError } from '@/lib/auth/map-register-error'
import { getFirstRegisterFieldError } from '@/lib/auth/register-form-a11y'
import { registerSchema, type RegisterFormData } from '@/lib/validations/auth'
import { allPasswordRulesMet } from '@/lib/validations/password-rules'

const PASSWORD_VALIDATION_MESSAGE =
  'Password does not meet all requirements'
import { CheckCircle, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useAuth } from '@/components/providers/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  PasswordRequirements,
  PASSWORD_REQUIREMENTS_ID,
} from '@/components/auth/PasswordRequirements'
import { RegisterFormField } from '@/components/auth/RegisterFormField'

/**
 * Register Form Component
 *
 * Handles user registration with email, username, password, and optional name.
 * Includes form validation, error handling, and loading states.
 */

export default function RegisterForm() {
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitAnnouncement, setSubmitAnnouncement] = useState<string | null>(
    null
  )
  const [success, setSuccess] = useState(false)
  const [highlightPasswordFailures, setHighlightPasswordFailures] =
    useState(false)

  const router = useRouter()
  const { signIn } = useAuth()

  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    watch,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    reValidateMode: 'onChange',
  })

  const password = watch('password') ?? ''

  useEffect(() => {
    if (highlightPasswordFailures && allPasswordRulesMet(password)) {
      setHighlightPasswordFailures(false)
    }
  }, [password, highlightPasswordFailures])

  const clearFieldFeedback = (name: keyof RegisterFormData) => {
    clearErrors(name)
    setFormError(null)
    setSubmitAnnouncement(null)
  }

  const registerField = (name: keyof RegisterFormData) =>
    register(name, {
      onChange: () => clearFieldFeedback(name),
    })

  const registerPasswordField = () =>
    register('password', {
      onChange: () => {
        clearFieldFeedback('password')
      },
    })

  const announceFirstError = (formErrors: FieldErrors<RegisterFormData>) => {
    const first = getFirstRegisterFieldError(formErrors)
    if (!first) return
    setSubmitAnnouncement(first.message)
    document.getElementById(first.field)?.focus()
  }

  const onSubmit = async (data: RegisterFormData) => {
    setIsLoading(true)
    setFormError(null)
    setSubmitAnnouncement(null)

    try {
      await signIn('password', {
        email: data.email,
        password: data.password,
        flow: 'signUp',
        username: data.username,
        ...(data.name && { name: data.name }),
      })

      setSuccess(true)
      router.replace('/')
    } catch (error) {
      const result = parseRegisterSignInError(error)
      setSubmitAnnouncement(result.message)

      if (result.field) {
        setError(result.field, { type: 'server', message: result.message })
        setFormError(null)
        document.getElementById(result.field)?.focus()
      } else {
        setFormError(result.message)
      }

      setIsLoading(false)
    }
  }

  const onInvalid = (formErrors: FieldErrors<RegisterFormData>) => {
    const first = getFirstRegisterFieldError(formErrors)

    if (first?.field === 'password') {
      setHighlightPasswordFailures(true)
      setError('password', {
        type: 'manual',
        message: PASSWORD_VALIDATION_MESSAGE,
      })
      setSubmitAnnouncement(PASSWORD_VALIDATION_MESSAGE)
      document.getElementById('password')?.focus()
      return
    }

    announceFirstError(formErrors)
  }

  if (success) {
    return (
      <div className="text-center space-y-4">
        <div className="p-4 bg-muted border border-border rounded-lg">
          <p className="inline-flex items-center justify-center gap-2 text-sm text-foreground">
            <CheckCircle
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-success-foreground"
            />
            <span>
              Account created successfully! Redirecting to dashboard...
            </span>
          </p>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-4">
      {submitAnnouncement ? (
        <p role="alert" className="sr-only">
          {submitAnnouncement}
        </p>
      ) : null}

      {formError ? (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-200 rounded-lg"
        >
          <p className="text-sm text-red-700">{formError}</p>
        </div>
      ) : null}

      <RegisterFormField
        id="email"
        label="Email address"
        error={errors.email?.message}
      >
        {(control) => (
          <Input
            {...registerField('email')}
            type="email"
            id="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={control['aria-invalid']}
            aria-describedby={control['aria-describedby']}
            className={control.inputClassName}
          />
        )}
      </RegisterFormField>

      <RegisterFormField
        id="username"
        label="Username"
        error={errors.username?.message}
      >
        {(control) => (
          <Input
            {...registerField('username')}
            type="text"
            id="username"
            autoComplete="username"
            placeholder="Choose a unique username"
            aria-invalid={control['aria-invalid']}
            aria-describedby={control['aria-describedby']}
            className={control.inputClassName}
          />
        )}
      </RegisterFormField>

      <RegisterFormField
        id="name"
        label={
          <>
            Full Name <span className="text-muted-foreground">(optional)</span>
          </>
        }
        error={errors.name?.message}
      >
        {(control) => (
          <Input
            {...registerField('name')}
            type="text"
            id="name"
            autoComplete="name"
            placeholder="Your full name"
            aria-invalid={control['aria-invalid']}
            aria-describedby={control['aria-describedby']}
            className={control.inputClassName}
          />
        )}
      </RegisterFormField>

      <RegisterFormField
        id="password"
        label="Password"
        error={errors.password?.message}
        extraDescribedBy={PASSWORD_REQUIREMENTS_ID}
      >
        {(control) => (
          <>
            <div className="relative">
              <Input
                {...registerPasswordField()}
                type={showPassword ? 'text' : 'password'}
                id="password"
                autoComplete="new-password"
                placeholder="Create a secure password"
                aria-invalid={control['aria-invalid']}
                aria-describedby={control['aria-describedby']}
                className={`pr-10 ${control.inputClassName}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="absolute right-3 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
            </div>
            <PasswordRequirements
              password={password}
              highlightFailures={highlightPasswordFailures}
            />
          </>
        )}
      </RegisterFormField>

      <RegisterFormField
        id="confirmPassword"
        label="Confirm Password"
        error={errors.confirmPassword?.message}
      >
        {(control) => (
          <div className="relative">
            <Input
              {...registerField('confirmPassword')}
              type={showConfirmPassword ? 'text' : 'password'}
              id="confirmPassword"
              autoComplete="new-password"
              placeholder="Confirm your password"
              aria-invalid={control['aria-invalid']}
              aria-describedby={control['aria-describedby']}
              className={`pr-10 ${control.inputClassName}`}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              aria-label={
                showConfirmPassword
                  ? 'Hide confirm password'
                  : 'Show confirm password'
              }
              aria-pressed={showConfirmPassword}
              className="absolute right-3 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showConfirmPassword ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          </div>
        )}
      </RegisterFormField>

      <Button
        type="submit"
        disabled={isLoading}
        className="w-full rounded-lg shadow-sm hover:bg-brand-accent focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-blue"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Creating account...
          </>
        ) : (
          'Create account'
        )}
      </Button>
    </form>
  )
}
