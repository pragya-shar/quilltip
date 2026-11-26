'use client'

import Link from 'next/link'
import { ChevronDown, LogOut } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { UserAvatar } from '@/components/ui/user-avatar'
import { cn } from '@/lib/utils'
import type { SiteNavigationLink } from '@/lib/navigation/siteNavigation'

export type AccountMenuUser = {
  name?: string | null
  username?: string | null
  avatar?: string | null
}

/**
 * The signed-in writer's menu. The trigger shows their photo (or initial);
 * screen readers hear "Account menu".
 */
export function AccountNavigationMenu({
  links,
  pathname,
  signOut,
  user,
  triggerClassName,
}: {
  links: SiteNavigationLink[]
  pathname: string
  signOut: () => Promise<void>
  user: AccountMenuUser | null
  triggerClassName?: string
}) {
  const displayName = user?.name?.trim() || user?.username || 'Your account'
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className={cn('app-account-trigger', triggerClassName)}
        aria-label="Account menu"
      >
        <UserAvatar
          src={user?.avatar}
          alt=""
          name={displayName}
          className="app-account-avatar"
          fallbackClassName="app-account-avatar-fallback"
        />
        <ChevronDown size={16} aria-hidden className="app-account-chevron" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={10}
        className="app-account-menu site-chrome"
      >
        <DropdownMenuLabel className="app-account-identity">
          <span className="app-account-name">{displayName}</span>
          {user?.username && (
            <span className="app-account-handle">@{user.username}</span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="app-account-separator" />
        {links.map(({ href, label }) => (
          <DropdownMenuItem key={label} asChild>
            <Link
              href={href}
              aria-current={pathname === href ? 'page' : undefined}
            >
              {label}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator className="app-account-separator" />
        <DropdownMenuItem
          className="app-account-signout"
          onSelect={() => {
            void signOut()
          }}
        >
          <LogOut size={16} aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
