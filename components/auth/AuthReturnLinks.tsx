'use client'

import { Suspense } from 'react'
import { AuthReturnLinksInner } from '@/components/auth/AuthReturnLinksInner'

export function AuthReturnLinks({
  variant,
}: {
  variant: 'login' | 'register'
}) {
  return (
    <Suspense fallback={null}>
      <AuthReturnLinksInner variant={variant} />
    </Suspense>
  )
}
