'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import {
  buildLoginHref,
  buildRegisterHref,
  getSafeReturnPath,
} from '@/lib/auth/safeReturnPath'
import { clearPendingTipIntent } from '@/lib/tip/pendingTipIntent'

function AuthReturnLinksInner({
  variant,
}: {
  variant: 'login' | 'register'
}) {
  const searchParams = useSearchParams()
  const returnTo = getSafeReturnPath(searchParams.get('returnTo'))

  const handleCancel = () => {
    clearPendingTipIntent()
  }

  if (variant === 'login') {
    return (
      <div className="space-y-4">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            Don&apos;t have an account?{' '}
            <Link
              href={buildRegisterHref(returnTo)}
              className="font-medium text-brand-blue hover:text-brand-accent transition-colors"
            >
              Sign up for free
            </Link>
          </p>
        </div>
        <div className="text-center">
          <Link
            href={returnTo}
            onClick={handleCancel}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link
            href={buildLoginHref(returnTo)}
            className="font-medium text-brand-blue hover:text-brand-accent transition-colors"
          >
            Sign in here
          </Link>
        </p>
      </div>
      <div className="text-center">
        <Link
          href={returnTo}
          onClick={handleCancel}
          className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </Link>
      </div>
    </div>
  )
}

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
