import LoginForm from '@/components/auth/LoginForm'
import { AuthAlternateLink } from '@/components/auth/AuthAlternateLink'

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
        <h2 className="text-2xl font-bold text-foreground">
          Sign in to your account
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Welcome back! Please enter your details.
        </p>
      </div>

      {/* Login Form */}
      <LoginForm />

      {/* Registration Link */}
      <div className="text-center">
        <AuthAlternateLink
          authPath="/register"
          prompt="Don't have an account?"
          linkLabel="Sign up for free"
        />
      </div>
    </div>
  )
}
