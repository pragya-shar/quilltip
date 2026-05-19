import Link from 'next/link'
import { LegalLinks } from '@/components/legal/LegalLinks'

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
    <div className="min-h-screen bg-gradient-to-br from-brand-cream to-background dark:from-background dark:to-muted">
      {/* Navigation Header */}
      <header className="absolute top-0 left-0 right-0 z-10">
        <nav className="container mx-auto px-6 py-6">
          <Link
            href="/"
            className="inline-flex items-center text-2xl font-bold text-brand-blue hover:text-brand-accent transition-colors"
          >
            <span className="font-handwritten text-3xl mr-2">Q</span>
            Quilltip
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
            <h1 className="text-3xl font-bold text-foreground">
              Welcome to Quilltip
            </h1>
            <p className="mt-2 text-muted-foreground">
              Where your words find their worth
            </p>
          </div>

          {/* Auth Form Card */}
          <div className="bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] border border-border p-8">
            {children}
          </div>

          {/* Footer Links */}
          <div className="mt-8 text-center text-sm text-muted-foreground">
            <p>
              By continuing, you agree to Quilltip&apos;s{' '}
              <LegalLinks
                conjunction="and"
                linkClassName="text-primary hover:underline"
              />
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
