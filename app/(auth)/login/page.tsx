import { Suspense } from 'react'
import LoginForm from '@/components/auth/LoginForm'
import { AuthReturnLinks } from '@/components/auth/AuthReturnLinks'

/**
 * Login Page
 *
 * Provides user login functionality with email and password.
 * Integrates with Convex Auth for authentication.
 */

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-foreground">
          Sign in to your account
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Welcome back! Please enter your details.
        </p>
      </div>

      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>

      <AuthReturnLinks variant="login" />
    </div>
  )
}
