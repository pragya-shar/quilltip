'use client'

import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/providers/AuthContext'
import { getAccountNavigationLinks } from '@/lib/navigation/siteNavigation'
import { AccountNavigationMenu } from './AccountNavigationMenu'

/** The account menu for headers that do not use AppNavigation. */
export function SignedInAccountMenu({
  triggerClassName,
}: {
  triggerClassName?: string
}) {
  const { user, isAuthenticated, signOut } = useAuth()
  const pathname = usePathname()
  if (!isAuthenticated) return null
  return (
    <AccountNavigationMenu
      links={getAccountNavigationLinks(user?.username)}
      pathname={pathname}
      signOut={signOut}
      user={user}
      triggerClassName={triggerClassName}
    />
  )
}
