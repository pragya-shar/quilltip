'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { parseSafeNextParam } from '@/lib/profile/profileDestination'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { mapRegisterSignInError } from '@/lib/auth/map-register-error'
import { registerSchema, type RegisterFormData } from '@/lib/validations/auth'
import { CheckCircle, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useAuth } from '@/components/providers/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const authInputClassName =
  'rounded-lg bg-background text-foreground focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:border-transparent'

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
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const router = useRouter()
  const searchParams = useSearchParams()
  const { signIn } = useAuth()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  })

  const onSubmit = async (data: RegisterFormData) => {
    setIsLoading(true)
    setError(null)

    try {
      await signIn('password', {
        email: data.email,
        password: data.password,
        flow: 'signUp',
        username: data.username,
        ...(data.name && { name: data.name }),
      })

      setSuccess(true)
      const next = parseSafeNextParam(searchParams.get('next'))
      router.replace(next ?? '/')
    } catch (error) {
      setError(mapRegisterSignInError(error))
      setIsLoading(false)
    }
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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Email Field */}
      <div>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-foreground mb-2"
        >
          Email address
        </label>
        <Input
          {...register('email')}
          type="email"
          id="email"
          autoComplete="email"
          className={authInputClassName}
          placeholder="you@example.com"
        />
        {errors.email && (
          <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
        )}
      </div>

      {/* Username Field */}
      <div>
        <label
          htmlFor="username"
          className="block text-sm font-medium text-foreground mb-2"
        >
          Username
        </label>
        <Input
          {...register('username')}
          type="text"
          id="username"
          autoComplete="username"
          className={authInputClassName}
          placeholder="Choose a unique username"
        />
        {errors.username && (
          <p className="mt-1 text-sm text-red-600">{errors.username.message}</p>
        )}
      </div>

      {/* Name Field (Optional) */}
      <div>
        <label
          htmlFor="name"
          className="block text-sm font-medium text-foreground mb-2"
        >
          Full Name <span className="text-muted-foreground">(optional)</span>
        </label>
        <Input
          {...register('name')}
          type="text"
          id="name"
          autoComplete="name"
          className={authInputClassName}
          placeholder="Your full name"
        />
        {errors.name && (
          <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
        )}
      </div>

      {/* Password Field */}
      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-foreground mb-2"
        >
          Password
        </label>
        <div className="relative">
          <Input
            {...register('password')}
            type={showPassword ? 'text' : 'password'}
            id="password"
            autoComplete="new-password"
            className={`pr-10 ${authInputClassName}`}
            placeholder="Create a secure password"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </Button>
        </div>
        {errors.password && (
          <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
        )}
      </div>

      {/* Confirm Password Field */}
      <div>
        <label
          htmlFor="confirmPassword"
          className="block text-sm font-medium text-foreground mb-2"
        >
          Confirm Password
        </label>
        <div className="relative">
          <Input
            {...register('confirmPassword')}
            type={showConfirmPassword ? 'text' : 'password'}
            id="confirmPassword"
            autoComplete="new-password"
            className={`pr-10 ${authInputClassName}`}
            placeholder="Confirm your password"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            className="absolute right-3 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showConfirmPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </Button>
        </div>
        {errors.confirmPassword && (
          <p className="mt-1 text-sm text-red-600">
            {errors.confirmPassword.message}
          </p>
        )}
      </div>

      {/* Submit Button */}
      <Button
        type="submit"
        disabled={isLoading}
        className="w-full rounded-lg shadow-sm hover:bg-brand-accent focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-blue"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Creating account...
          </>
        ) : (
          'Create account'
        )}
      </Button>
    </form>
  )
}
