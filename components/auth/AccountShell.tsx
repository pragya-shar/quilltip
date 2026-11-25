import type { ReactNode } from 'react'
import Link from 'next/link'

/**
 * Paper layout shared by account pages that are not log in or sign up, such
 * as the waitlist and password recovery. Matches AccountScreen.
 */
export function AccountShell({
  marginNote,
  title,
  description,
  children,
  footer,
}: {
  marginNote: string
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <>
      <main className="account-layout">
        <div className="account-margin" aria-hidden="true">
          <span>{marginNote}</span>
          <svg viewBox="0 0 130 75" fill="none">
            <path
              d="M8 8C12 61 67 64 116 43M103 36l15 6-8 15"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <section className="account-paper" aria-labelledby="account-title">
          <div className="account-form-inner">
            <h1 id="account-title" tabIndex={-1}>
              {title}
            </h1>
            {description && (
              <p className="account-description">{description}</p>
            )}
            {children}
            {footer}
            <p className="account-legal">
              See QuillTip’s <Link href="/terms">Terms of Service</Link> and{' '}
              <Link href="/privacy">Privacy Policy</Link>.
            </p>
          </div>
        </section>
      </main>
      <footer className="account-footer">
        <span>Read freely. Write in your own voice.</span>
        <Link href="/">Back to QuillTip</Link>
      </footer>
    </>
  )
}
