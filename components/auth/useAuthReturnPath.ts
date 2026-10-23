'use client'

import { useSearchParams } from 'next/navigation'
import { getSafeReturnPath } from '@/lib/auth/safeReturnPath'

export function useAuthReturnPath(): string {
  const searchParams = useSearchParams()
  return getSafeReturnPath(
    searchParams.get('redirect'),
    getSafeReturnPath(
      searchParams.get('returnTo'),
      getSafeReturnPath(searchParams.get('next'))
    )
  )
}
