'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { useAuthReturnPath } from './useAuthReturnPath'
import { buildLoginHref, buildRegisterHref } from '@/lib/auth/safeReturnPath'

export function AccountScreen({
  variant,
  children,
}: {
  variant: 'login' | 'register'
  children: ReactNode
}) {
  const destination = useAuthReturnPath()
  const login = variant === 'login'
  return (
    <>
      <main className="account-layout">
        <div className="account-margin" aria-hidden="true">
          <span>
            {login
              ? 'Back to your reading & writing.'
              : 'Your next chapter starts here.'}
          </span>
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
              {login ? 'Welcome back.' : 'Make yourself at home.'}
            </h1>
            <p className="account-description">
              {login
                ? 'Your stories and saved passages are waiting.'
                : destination.split(/[?#]/)[0] === '/library'
                  ? 'Create an account to keep your bookmarked articles and passages together. Reading is always open.'
                  : 'An account for reading, writing, and the words you want to keep.'}
            </p>
            {children}
            <p className="account-switch">
              {login ? 'New to QuillTip?' : 'Already have an account?'}{' '}
              <Link
                href={
                  login
                    ? buildRegisterHref(destination)
                    : buildLoginHref(destination)
                }
              >
                {login ? 'Sign up' : 'Log in'}
              </Link>
            </p>
            <p className="account-legal">
              By continuing, you agree to QuillTip’s{' '}
              <Link href="/terms">Terms of Service</Link> and{' '}
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
