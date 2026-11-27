import type { Metadata } from 'next'
import Link from 'next/link'
import { AccountShell } from '@/components/auth/AccountShell'
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'
import '@/components/auth/recovery.css'

export const metadata: Metadata = { title: 'Reset your password · Quilltip' }

export default function ForgotPasswordPage() {
  return (
    <AccountShell
      marginNote="It happens to every writer."
      title="Reset your password."
      description="Enter the email you use for Quilltip. We’ll send a code to set a new password."
      footer={
        <p className="account-switch">
          Remembered it? <Link href="/login">Back to log in</Link>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AccountShell>
  )
}
