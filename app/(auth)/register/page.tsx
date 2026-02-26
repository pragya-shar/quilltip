import Link from 'next/link'
import RegisterForm from '@/components/auth/RegisterForm'

/**
 * Registration Page
 *
 * Provides user registration functionality with email, username, and password.
 * Creates new user accounts in the database.
 */

export default function RegisterPage() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="text-center">
        <h2 className="text-2xl font-bold text-quill-900">
          Create your account
        </h2>
        <p className="mt-2 text-sm text-quill-600">
          Join QuillTip and start sharing your stories with the world.
        </p>
      </div>

      {/* Registration Form */}
      <RegisterForm />

      {/* Login Link */}
      <div className="text-center">
        <p className="text-sm text-quill-600">
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-brand-blue hover:text-brand-accent transition-colors"
          >
            Sign in here
          </Link>
        </p>
      </div>
    </div>
  )
}
