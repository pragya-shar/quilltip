import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { AccountShell } from '@/components/auth/AccountShell'
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm'
import '@/components/auth/recovery.css'

export const metadata: Metadata = {
  title: 'Choose a new password · QuillTip',
  // The page can be opened from an emailed link that carries a code.
  referrer: 'no-referrer',
  robots: { index: false },
}

export default function ResetPasswordPage() {
  return (
    <AccountShell
      marginNote="A fresh page."
      title="Choose a new password."
      description="Use the code from your email. It works once and expires after 15 minutes."
      footer={
        <p className="account-switch">
          Need a code? <Link href="/forgot-password">Request one</Link>
        </p>
      }
    >
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AccountShell>
  )
}
