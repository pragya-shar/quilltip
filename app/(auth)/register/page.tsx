import { Suspense } from 'react'
import RegisterForm from '@/components/auth/RegisterForm'
import { AuthReturnLinks } from '@/components/auth/AuthReturnLinks'
import { AuthIntentHeading } from '@/components/auth/AuthIntentHeading'

/**
 * Registration Page
 *
 * Provides user registration functionality with email, username, and password.
 * Creates new user accounts in the database.
 */

export default function RegisterPage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <AuthIntentHeading variant="register" />
      </Suspense>

      <Suspense fallback={null}>
        <RegisterForm />
      </Suspense>

      <AuthReturnLinks variant="register" />
    </div>
  )
}
