import { Suspense } from 'react'
import type { Metadata } from 'next'
import RegisterForm from '@/components/auth/RegisterForm'
import { AccountScreen } from '@/components/auth/AccountScreen'

export const metadata: Metadata = { title: 'Make yourself at home. · QuillTip' }
export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <AccountScreen variant="register">
        <RegisterForm />
      </AccountScreen>
    </Suspense>
  )
}
