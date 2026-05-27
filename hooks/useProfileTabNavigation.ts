'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  buildCurrentProfilePath,
  buildProfileTabHref,
  type ProfileTabId,
} from '@/lib/profile/profileTab'

export function useProfileTabNavigation() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  return (tab: ProfileTabId) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    const href = buildProfileTabHref(pathname, params, tab)
    const current = buildCurrentProfilePath(pathname, params)
    if (href === current) return
    router.push(href)
  }
}
