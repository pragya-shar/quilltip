'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { registerSchema, type RegisterFormData } from '@/lib/validations/auth'
import { CheckCircle, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useAuth } from '@/components/providers/AuthContext'

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
      // Use replace to prevent back button returning to register
      router.replace('/')
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Registration failed. Please try again.'
      )
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
        <input
          {...register('email')}
          type="email"
          id="email"
          autoComplete="email"
          className="w-full px-3 py-2 border border-input bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-transparent"
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
        <input
          {...register('username')}
          type="text"
          id="username"
          autoComplete="username"
          className="w-full px-3 py-2 border border-input bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-transparent"
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
        <input
          {...register('name')}
          type="text"
          id="name"
          autoComplete="name"
          className="w-full px-3 py-2 border border-input bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-transparent"
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
          <input
            {...register('password')}
            type={showPassword ? 'text' : 'password'}
            id="password"
            autoComplete="new-password"
            className="w-full px-3 py-2 pr-10 border border-input bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-transparent"
            placeholder="Create a secure password"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
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
          <input
            {...register('confirmPassword')}
            type={showConfirmPassword ? 'text' : 'password'}
            id="confirmPassword"
            autoComplete="new-password"
            className="w-full px-3 py-2 pr-10 border border-input bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-transparent"
            placeholder="Confirm your password"
          />
          <button
            type="button"
            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showConfirmPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
        {errors.confirmPassword && (
          <p className="mt-1 text-sm text-red-600">
            {errors.confirmPassword.message}
          </p>
        )}
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isLoading}
        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-brand-blue hover:bg-brand-accent focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-blue disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Creating account...
          </>
        ) : (
          'Create account'
        )}
      </button>
    </form>
  )
}
