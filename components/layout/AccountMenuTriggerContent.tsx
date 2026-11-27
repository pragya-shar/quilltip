'use client'

import { ChevronDown } from 'lucide-react'
import { UserAvatar } from '@/components/ui/user-avatar'
import { accountDisplayName, type AccountMenuUser } from './accountMenu'

/** The account menu trigger's face: the writer's photo (or initial) and a chevron. */
export function AccountMenuTriggerContent({
  user,
}: {
  user: AccountMenuUser | null
}) {
  return (
    <>
      <UserAvatar
        src={user?.avatar}
        alt=""
        name={accountDisplayName(user)}
        className="app-account-avatar"
        fallbackClassName="app-account-avatar-fallback"
      />
      <ChevronDown size={16} aria-hidden className="app-account-chevron" />
    </>
  )
}
