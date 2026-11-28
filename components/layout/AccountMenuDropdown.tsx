'use client'

import Link from 'next/link'
import { LogOut } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { AccountMenuTriggerContent } from './AccountMenuTriggerContent'
import { useEffect, useRef } from 'react'
import {
  accountDisplayName,
  type AccountMenuHandoff,
  type AccountNavigationMenuProps,
} from './accountMenu'

/**
 * The Radix dropdown behind the account menu. AccountNavigationMenu loads it
 * on demand, so pages do not ship menu code to signed-out readers.
 */
export function AccountMenuDropdown({
  links,
  pathname,
  signOut,
  user,
  triggerClassName,
  handoff,
}: AccountNavigationMenuProps & { handoff?: AccountMenuHandoff }) {
  const displayName = accountDisplayName(user)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Take over from the placeholder trigger that showed while this code
  // loaded (AccountNavigationMenu): keep its focus, and open the menu the
  // way it was asked for. A replayed Enter lets the menu treat the open as
  // keyboard use and focus the first item.
  const initialHandoff = useRef(handoff)
  useEffect(() => {
    const trigger = triggerRef.current
    const first = initialHandoff.current
    if (!trigger || !first) return
    if (first.focused || first.open) trigger.focus()
    if (first.open === 'keyboard') {
      trigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      )
    }
  }, [])
  return (
    <DropdownMenu
      modal={false}
      defaultOpen={initialHandoff.current?.open === 'pointer'}
    >
      <DropdownMenuTrigger
        ref={triggerRef}
        className={cn('app-account-trigger', triggerClassName)}
        aria-label="Account menu"
      >
        <AccountMenuTriggerContent user={user} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={10}
        className="app-account-menu site-chrome ui-light"
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
