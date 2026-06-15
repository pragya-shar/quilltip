'use client'

import { useAuthReturnPath } from '@/components/auth/useAuthReturnPath'
import {
  getLoginCopy,
  getRegisterCopy,
  type AuthPageCopy,
} from '@/lib/copy/auth-intent'

interface AuthIntentHeadingProps {
  variant: 'login' | 'register'
}

function getCopy(variant: AuthIntentHeadingProps['variant'], returnPath: string): AuthPageCopy {
  return variant === 'register'
    ? getRegisterCopy(returnPath)
    : getLoginCopy(returnPath)
}

export function AuthIntentHeading({ variant }: AuthIntentHeadingProps) {
  const returnPath = useAuthReturnPath()
  const { heading, subtitle } = getCopy(variant, returnPath)

  return (
    <div className="text-center">
      <h2 className="text-2xl font-bold text-foreground">{heading}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  )
}

export function useAuthPageCopy(variant: AuthIntentHeadingProps['variant']): AuthPageCopy {
  const returnPath = useAuthReturnPath()
  return getCopy(variant, returnPath)
}
