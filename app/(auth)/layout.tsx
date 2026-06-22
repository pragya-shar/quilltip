import Link from 'next/link'
import { LegalLinks } from '@/components/legal/LegalLinks'
import { AuthShellHeader } from '@/components/auth/AuthShellHeader'
import { AUTH_FOOTER_LINKS } from '@/lib/copy/footer-links'

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
      <AuthShellHeader />

      <main className="flex min-h-screen items-start justify-center px-6 pb-20 pt-28 sm:pt-32">
        <div className="w-full max-w-md mt-8">
          <div className="bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] border border-border p-8">
            {children}
          </div>

          {/* Footer Links */}
          <div className="mt-8 space-y-3 text-center text-sm text-muted-foreground">
            <p>
              By continuing, you agree to Quilltip&apos;s{' '}
              <LegalLinks
                conjunction="and"
                linkClassName="text-primary hover:underline"
              />
            </p>
            <p>
              {AUTH_FOOTER_LINKS.map((link, index) => (
                <span key={link.href}>
                  {index > 0 ? (
                    <span className="mx-1.5 text-muted-foreground" aria-hidden>
                      |
                    </span>
                  ) : null}
                  <Link
                    href={link.href}
                    className="text-primary hover:underline underline-offset-4"
                  >
                    {link.label}
                  </Link>
                </span>
              ))}
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
