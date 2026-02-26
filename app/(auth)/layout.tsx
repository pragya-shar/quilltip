import Link from 'next/link'

/**
 * Auth Layout
 *
 * This layout wraps all authentication pages (login, register).
 * Provides a clean, centered layout for auth forms.
 * Authentication redirect logic is handled by individual auth pages.
 */

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-cream to-white">
      {/* Navigation Header */}
      <header className="absolute top-0 left-0 right-0 z-10">
        <nav className="container mx-auto px-6 py-6">
          <Link
            href="/"
            className="inline-flex items-center text-2xl font-bold text-brand-blue hover:text-brand-accent transition-colors"
          >
            <span className="font-handwritten text-3xl mr-2">Q</span>
            QuillTip
          </Link>
        </nav>
      </header>

      {/* Auth Form Container */}
      <main className="flex min-h-screen items-center justify-center px-6 py-20">
        <div className="w-full max-w-md">
          {/* Logo and Welcome Message */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center mb-4">
              <span className="text-5xl font-handwritten text-brand-blue">
                Q
              </span>
            </div>
            <h1 className="text-3xl font-bold text-quill-900">
              Welcome to QuillTip
            </h1>
            <p className="mt-2 text-quill-600">
              Where your words find their worth
            </p>
          </div>

          {/* Auth Form Card */}
          <div className="bg-white rounded-2xl shadow-xl border border-quill-200 p-8">
            {children}
          </div>

          {/* Footer Links */}
          <div className="mt-8 text-center text-sm text-quill-600">
            <p>
              By continuing, you agree to QuillTip&apos;s{' '}
              <Link href="/terms" className="text-brand-blue hover:underline">
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link href="/privacy" className="text-brand-blue hover:underline">
                Privacy Policy
              </Link>
            </p>
          </div>
        </div>
      </main>

      {/* Background Decoration */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-brand-blue/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-brand-accent/5 rounded-full blur-3xl" />
      </div>
    </div>
  )
}
