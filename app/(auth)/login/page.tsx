import Link from 'next/link'
import LoginForm from '@/components/auth/LoginForm'

/**
 * Login Page
 *
 * Provides user login functionality with email and password.
 * Integrates with NextAuth for authentication.
 */

export default function LoginPage() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="text-center">
        <h2 className="text-2xl font-bold text-quill-900">
          Sign in to your account
        </h2>
        <p className="mt-2 text-sm text-quill-600">
          Welcome back! Please enter your details.
        </p>
      </div>

      {/* Login Form */}
      <LoginForm />

      {/* Registration Link */}
      <div className="text-center">
        <p className="text-sm text-quill-600">
          Don&apos;t have an account?{' '}
          <Link
            href="/register"
            className="font-medium text-brand-blue hover:text-brand-accent transition-colors"
          >
            Sign up for free
          </Link>
        </p>
      </div>
    </div>
  )
}
