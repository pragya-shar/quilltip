import { Suspense } from 'react'
import LoginForm from '@/components/auth/LoginForm'
import { AuthReturnLinks } from '@/components/auth/AuthReturnLinks'
import { AuthIntentHeading } from '@/components/auth/AuthIntentHeading'

/**
 * Login Page
 *
 * Provides user login functionality with email and password.
 * Integrates with Convex Auth for authentication.
 */

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <AuthIntentHeading variant="login" />
      </Suspense>

      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>

      <AuthReturnLinks variant="login" />
    </div>
  )
}
