'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  buildProfileTabHref,
  type ProfileTabId,
} from '@/lib/profile/profileTab'

export function useProfileTabNavigation() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  return (tab: ProfileTabId) => {
    router.push(
      buildProfileTabHref(
        pathname,
        new URLSearchParams(searchParams?.toString() ?? ''),
        tab
      )
    )
  }
}
