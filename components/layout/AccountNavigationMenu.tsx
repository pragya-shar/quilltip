'use client'

import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { SiteNavigationLink } from '@/lib/navigation/siteNavigation'

export function AccountNavigationMenu({
  links,
  pathname,
  signOut,
}: {
  links: SiteNavigationLink[]
  pathname: string
  signOut: () => Promise<void>
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="app-nav-action">
        Account <ChevronDown size={16} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={12}
        className="app-account-menu site-chrome"
      >
        {links.map(({ href, label }) => (
          <DropdownMenuItem key={href} asChild>
            <Link
              href={href}
              aria-current={pathname === href ? 'page' : undefined}
            >
              {label}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem asChild>
          <Link href="/support">Help &amp; support</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void signOut()
          }}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
