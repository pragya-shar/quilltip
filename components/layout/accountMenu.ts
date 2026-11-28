import type { SiteNavigationLink } from '@/lib/navigation/siteNavigation'

export type AccountMenuUser = {
  name?: string | null
  username?: string | null
  avatar?: string | null
}

export type AccountNavigationMenuProps = {
  links: SiteNavigationLink[]
  pathname: string
  signOut: () => Promise<void>
  user: AccountMenuUser | null
  triggerClassName?: string
}

export function accountDisplayName(user: AccountMenuUser | null): string {
  return user?.name?.trim() || user?.username || 'Your account'
}

/**
 * What happened on the placeholder trigger before the dropdown code loaded:
 * whether it had focus, and whether it was pressed (and how).
 */
export type AccountMenuHandoff = {
  focused: boolean
  open: 'keyboard' | 'pointer' | null
}
