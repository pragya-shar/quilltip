import { Suspense } from 'react'
import RegisterForm from '@/components/auth/RegisterForm'
import { AuthReturnLinks } from '@/components/auth/AuthReturnLinks'

/**
 * Registration Page
 *
 * Provides user registration functionality with email, username, and password.
 * Creates new user accounts in the database.
 */

export default function RegisterPage() {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-foreground">
          Create your account
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Join Quilltip and start sharing your stories with the world.
        </p>
      </div>

      <Suspense fallback={null}>
        <RegisterForm />
      </Suspense>

      <AuthReturnLinks variant="register" />
    </div>
  )
}
