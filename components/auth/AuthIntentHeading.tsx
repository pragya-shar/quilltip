'use client'

import { useAuthReturnPath } from '@/components/auth/useAuthReturnPath'
import { getAuthPageCopy, type AuthPageVariant } from '@/lib/copy/auth-intent'

interface AuthIntentHeadingProps {
  variant: AuthPageVariant
}

export function AuthIntentHeading({ variant }: AuthIntentHeadingProps) {
  const returnPath = useAuthReturnPath()
  const { heading, subtitle } = getAuthPageCopy(variant, returnPath)

  return (
    <div className="text-center">
      <h2 className="text-2xl font-bold text-foreground">{heading}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  )
}
