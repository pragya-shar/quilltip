import { Suspense } from 'react'
import type { Metadata } from 'next'
import LoginForm from '@/components/auth/LoginForm'
import { AccountScreen } from '@/components/auth/AccountScreen'

export const metadata: Metadata = { title: 'Welcome back. · QuillTip' }
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <AccountScreen variant="login">
        <LoginForm />
      </AccountScreen>
    </Suspense>
  )
}
