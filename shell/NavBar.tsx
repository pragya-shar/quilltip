'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from '@/system/components/Icon'
import { NAVIGATION, destinationsFor, isActive } from './navigation'
import { NavPending } from './NavPending'

/**
 * The phone navigation: a floating bar in thumb reach, above the home
 * indicator and a host browser's toolbar. Real links in the server HTML, so
 * it works before scripts load. It hides while the on-screen keyboard is
 * up and on immersive pages (CSS, see shell.css).
 */
export function NavBar() {
  const pathname = usePathname() ?? '/'
  const items = destinationsFor(NAVIGATION, 'phone')
  return (
    <nav className="qt-navbar" aria-label="Main">
      <ul className="qt-navbar__list">
        {items.map((item) => {
          const active = isActive(item, pathname)
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                className="qt-navbar__item"
                aria-current={active ? 'page' : undefined}
              >
                <Icon icon={item.icon} size={24} />
                <span className="qt-navbar__label">{item.label}</span>
                <NavPending />
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
