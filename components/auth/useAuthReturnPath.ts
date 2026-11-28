'use client'

import { useSearchParams } from 'next/navigation'
import { resolveAuthReturnPath } from '@/lib/auth/safeReturnPath'

export function useAuthReturnPath(): string {
  return resolveAuthReturnPath(useSearchParams())
}
