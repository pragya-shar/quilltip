import type { Metadata } from 'next'
import Link from 'next/link'
import { AccountShell } from '@/components/auth/AccountShell'
import { WaitlistForm } from '@/components/beta/WaitlistForm'

export const metadata: Metadata = {
  title: 'Join the beta waitlist · QuillTip',
  description:
    'Join the QuillTip beta waitlist. We invite new writers and readers in small groups.',
}

export default function WaitlistPage() {
  return (
    <AccountShell
      marginNote="Small groups, real feedback."
      title="Join the beta."
      description="We’re inviting writers and readers in small groups. Leave your email and we’ll send an invitation when a place opens."
      footer={
        <p className="account-switch">
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      }
    >
      <WaitlistForm />
    </AccountShell>
  )
}
